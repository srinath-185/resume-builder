import { Client, expect } from '@loopback/testlab';
import { ResumeBuilderApplication } from '../../application';
import { UserRole } from '../../models';
import { AuditLogRepository, LlmUsageLogRepository, UserRepository } from '../../repositories';
import { AdminService } from '../../services/admin/admin.service';
import { givenUser, TestUser } from '../helpers/auth.helper';
import { setupApplication } from '../helpers/test-app';

describe('Administration (acceptance)', () => {
  let app: ResumeBuilderApplication;
  let client: Client;
  let users: UserRepository;
  let superadmin: TestUser;
  let admin: TestUser;
  let member: TestUser;

  async function givenRole(role: UserRole): Promise<TestUser> {
    const user = await givenUser(client, role);
    await users.updateById(user.id, { role });
    return user;
  }

  before(async () => {
    ({ app, client } = await setupApplication());
    users = await app.getRepository(UserRepository);
  });

  beforeEach(async () => {
    superadmin = await givenRole(UserRole.SUPERADMIN);
    admin = await givenRole(UserRole.ADMIN);
    member = await givenUser(client, 'Member');
  });

  after(async () => {
    await app.stop();
  });

  it('refuses every /admin route to a normal user and to anonymous callers', async () => {
    const paths = Object.entries((await app.restServer.getApiSpec()).paths).filter(([path]) => path.startsWith('/admin'));
    expect(paths.length).to.be.greaterThan(5);
    for (const [path, operations] of paths) {
      const url = `/api${path.replace(/\{[^}]+\}/g, member.id)}`;
      for (const method of Object.keys(operations as object) as Array<'get' | 'post' | 'patch'>) {
        const denied = await client[method](url).set(member.auth).send({});
        expect({ method, path, status: denied.status }).to.eql({ method, path, status: 403 });
        const anonymous = await client[method](url).send({});
        expect({ method, path, status: anonymous.status }).to.eql({ method, path, status: 401 });
      }
    }
  });

  it('lists and searches users without exposing password hashes', async () => {
    const response = await client.get(`/api/admin/users?q=${encodeURIComponent(member.email)}`).set(admin.auth).expect(200);
    expect(response.body.data.total).to.equal(1);
    expect(response.body.data.items[0]).to.containDeep({ id: member.id, email: member.email, role: 'user', status: 'active' });
    expect(JSON.stringify(response.body)).to.not.match(/passwordHash|tokenVersion/);

    const admins = await client.get('/api/admin/users?role=superadmin').set(admin.auth).expect(200);
    expect(admins.body.data.items.every((user: { role: string }) => user.role === 'superadmin')).to.be.true();
  });

  it('disables an account (revoking its sessions) and enables it again, with an audit trail', async () => {
    const disabled = await client.patch(`/api/admin/users/${member.id}/status`).set(admin.auth).send({ status: 'disabled' }).expect(200);
    expect(disabled.body.data.status).to.equal('disabled');
    await client.get('/api/auth/me').set(member.auth).expect(401);

    await client.patch(`/api/admin/users/${member.id}/status`).set(admin.auth).send({ status: 'active' }).expect(200);
    // Re-enabling does not bring the old token back.
    expect((await client.get('/api/auth/me').set(member.auth).expect(401)).body.error.code).to.equal('TOKEN_INVALID');
    await client.post('/api/auth/login').send({ email: member.email, password: 'correct horse battery' }).expect(200);

    const audits = await (await app.getRepository(AuditLogRepository)).find({ where: { entityId: member.id, userId: admin.id } });
    expect(audits.map(audit => audit.action).sort()).to.eql(['ADMIN_USER_DISABLED', 'ADMIN_USER_ENABLED']);
  });

  it('keeps admins away from other admin accounts and from their own', async () => {
    const other = await givenRole(UserRole.ADMIN);
    const onAdmin = await client.patch(`/api/admin/users/${other.id}/status`).set(admin.auth).send({ status: 'disabled' }).expect(403);
    expect(onAdmin.body.error.code).to.equal('FORBIDDEN');
    await client.post(`/api/admin/users/${superadmin.id}/revoke-sessions`).set(admin.auth).expect(403);

    const onSelf = await client.patch(`/api/admin/users/${superadmin.id}/status`).set(superadmin.auth).send({ status: 'disabled' }).expect(422);
    expect(onSelf.body.error.code).to.equal('ADMIN_SELF_CHANGE');
    await client.patch(`/api/admin/users/${superadmin.id}/role`).set(superadmin.auth).send({ role: 'user' }).expect(422);
  });

  it('lets only a superadmin change roles, and a role change signs the user out', async () => {
    await client.patch(`/api/admin/users/${member.id}/role`).set(admin.auth).send({ role: 'admin' }).expect(403);

    const promoted = await client.patch(`/api/admin/users/${member.id}/role`).set(superadmin.auth).send({ role: 'admin' }).expect(200);
    expect(promoted.body.data.role).to.equal('admin');
    await client.get('/api/auth/me').set(member.auth).expect(401);

    const login = await client.post('/api/auth/login').send({ email: member.email, password: 'correct horse battery' }).expect(200);
    expect(login.body.data.user.role).to.equal('admin');
    await client.get('/api/admin/users').set({ Authorization: `Bearer ${login.body.data.token}` }).expect(200);
  });

  it('creates accounts; only a superadmin can create admins, with a longer password', async () => {
    const created = await client.post('/api/admin/users').set(admin.auth).send({ email: 'new@example.test', name: 'New', password: 'long enough pw' }).expect(200);
    expect(created.body.data).to.containDeep({ email: 'new@example.test', role: 'user', status: 'active' });

    await client.post('/api/admin/users').set(admin.auth).send({ email: 'boss@example.test', name: 'Boss', password: 'a long admin password', role: 'admin' }).expect(403);
    const weak = await client.post('/api/admin/users').set(superadmin.auth).send({ email: 'boss@example.test', name: 'Boss', password: 'short pw1', role: 'admin' }).expect(422);
    expect(weak.body.error.code).to.equal('PASSWORD_TOO_WEAK');
    await client.post('/api/admin/users').set(superadmin.auth).send({ email: 'boss@example.test', name: 'Boss', password: 'a long admin password', role: 'admin' }).expect(200);
  });

  it('shows the audit log and AI usage across users', async () => {
    const usage = await app.getRepository(LlmUsageLogRepository);
    await usage.createAll([
      { userId: member.id, task: 'resume_parse', provider: 'groq', model: 'm', inputTokens: 100, outputTokens: 20, latencyMs: 1, success: true },
      { userId: member.id, task: 'resume_parse', provider: 'groq', model: 'm', inputTokens: 5, outputTokens: 0, latencyMs: 1, success: false },
    ]);
    const summary = (await client.get('/api/admin/llm-usage').set(admin.auth).expect(200)).body.data;
    expect(summary.byProvider.find((row: { provider: string }) => row.provider === 'groq')).to.containDeep({ calls: 2, failures: 1, inputTokens: 105 });
    expect(summary.byUser.find((row: { userId: string }) => row.userId === member.id)).to.containDeep({ email: member.email, calls: 2 });

    const audit = (await client.get(`/api/admin/audit-logs?userId=${member.id}&action=USER_REGISTERED`).set(admin.auth).expect(200)).body.data;
    expect(audit.total).to.equal(1);
  });

  it('bootstraps a superadmin from the command line, creating or promoting', async () => {
    const service = await app.get<AdminService>('services.AdminService');
    const created = await service.bootstrapSuperadmin('Root@Example.test', 'Root', async () => 'a long admin password');
    expect(created).to.containDeep({ created: true, user: { email: 'root@example.test', role: 'superadmin' } });

    let asked = false;
    const promoted = await service.bootstrapSuperadmin(member.email, 'ignored', async () => {
      asked = true;
      return '';
    });
    expect(promoted).to.containDeep({ created: false, user: { id: member.id, role: 'superadmin' } });
    expect(asked).to.be.false();
    await client.get('/api/auth/me').set(member.auth).expect(401);

    await expect(service.bootstrapSuperadmin('weak@example.test', 'W', async () => 'too short')).to.be.rejectedWith(/at least 12/);
  });
});
