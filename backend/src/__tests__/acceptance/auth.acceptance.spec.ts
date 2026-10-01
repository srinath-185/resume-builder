import { Client, expect } from '@loopback/testlab';
import { ResumeBuilderApplication } from '../../application';
import { AuditLogRepository, UserRepository } from '../../repositories';
import { givenUser, withEnv } from '../helpers/auth.helper';
import { setupApplication } from '../helpers/test-app';

describe('Auth (acceptance)', () => {
  let app: ResumeBuilderApplication;
  let client: Client;

  before(async () => {
    ({ app, client } = await setupApplication());
  });

  after(async () => {
    await app.stop();
  });

  it('registers, then returns the caller from /auth/me', async () => {
    const user = await givenUser(client, 'Ada');
    const me = await client.get('/api/auth/me').set(user.auth).expect(200);
    expect(me.body.data).to.eql({ id: user.id, email: user.email, name: 'Ada', role: 'user' });
  });

  it('never returns the password hash', async () => {
    const response = await client
      .post('/api/auth/register')
      .send({ email: 'hash@example.test', password: 'long enough pw', name: 'H' })
      .expect(200);
    expect(JSON.stringify(response.body)).to.not.match(/passwordHash|\$2[aby]\$/);
  });

  it('normalises email and rejects duplicates with EMAIL_TAKEN', async () => {
    const first = await client
      .post('/api/auth/register')
      .send({ email: 'Dup@Example.test', password: 'long enough pw', name: 'A' })
      .expect(200);
    expect(first.body.data.user.email).to.equal('dup@example.test');
    const second = await client
      .post('/api/auth/register')
      .send({ email: 'dup@example.TEST', password: 'long enough pw', name: 'B' })
      .expect(409);
    expect(second.body.error.code).to.equal('EMAIL_TAKEN');
  });

  it('rejects a short password with a validation error', async () => {
    const response = await client.post('/api/auth/register').send({ email: 'short@example.test', password: 'short', name: 'S' }).expect(422);
    expect(response.body.error.code).to.equal('VALIDATION_ERROR');
  });

  it('logs in with the right password and records the audit trail', async () => {
    const user = await givenUser(client);
    const login = await client.post('/api/auth/login').send({ email: user.email.toUpperCase(), password: 'correct horse battery' }).expect(200);
    expect(login.body.data.token).to.be.a.String();
    const audits = await (await app.getRepository(AuditLogRepository)).find({ where: { userId: user.id } });
    expect(audits.map(a => a.action).sort()).to.eql(['USER_LOGGED_IN', 'USER_REGISTERED']);
  });

  it('rejects a wrong password with INVALID_CREDENTIALS', async () => {
    const user = await givenUser(client);
    const response = await client.post('/api/auth/login').send({ email: user.email, password: 'wrong password' }).expect(401);
    expect(response.body.error.code).to.equal('INVALID_CREDENTIALS');
  });

  it('gives the same answer for an unknown email', async () => {
    const response = await client.post('/api/auth/login').send({ email: 'nobody@example.test', password: 'whatever pw' }).expect(401);
    expect(response.body.error.code).to.equal('INVALID_CREDENTIALS');
  });

  it('requires a valid bearer token on protected routes', async () => {
    const missing = await client.get('/api/auth/me').expect(401);
    expect(missing.body.error.code).to.equal('UNAUTHENTICATED');
    const bad = await client.get('/api/auth/me').set({ Authorization: 'Bearer not-a-jwt' }).expect(401);
    expect(bad.body.error.code).to.equal('TOKEN_INVALID');
  });

  it('ignores any attempt to pick a role at sign-up', async () => {
    const response = await client
      .post('/api/auth/register')
      .send({ email: 'sneaky@example.test', password: 'long enough pw', name: 'S', role: 'superadmin' })
      .expect(422);
    expect(response.body.error.code).to.equal('VALIDATION_ERROR');
  });

  it('refuses sign-up when registration is closed', async () => {
    await withEnv({ REGISTRATION_MODE: 'closed' }, async () => {
      const response = await client.post('/api/auth/register').send({ email: 'closed@example.test', password: 'long enough pw', name: 'C' }).expect(403);
      expect(response.body.error.code).to.equal('REGISTRATION_CLOSED');
    });
  });

  it('limits sign-ups per address', async () => {
    const { app: limited, client: limitedClient } = await setupApplication();
    try {
      await withEnv({ REGISTER_MAX_PER_IP: '2' }, async () => {
        for (const n of [1, 2]) await limitedClient.post('/api/auth/register').send({ email: `ip${n}@example.test`, password: 'long enough pw', name: 'I' }).expect(200);
        const third = await limitedClient.post('/api/auth/register').send({ email: 'ip3@example.test', password: 'long enough pw', name: 'I' }).expect(429);
        expect(third.body.error.code).to.equal('RATE_LIMITED');
      });
    } finally {
      await limited.stop();
    }
  });

  it('locks an email out after repeated failures, even for the right password, and audits the failures', async () => {
    const user = await givenUser(client);
    await withEnv({ LOGIN_MAX_FAILURES_PER_EMAIL: '3' }, async () => {
      for (let i = 0; i < 3; i++) await client.post('/api/auth/login').send({ email: user.email, password: 'wrong password' }).expect(401);
      const locked = await client.post('/api/auth/login').send({ email: user.email, password: 'correct horse battery' }).expect(429);
      expect(locked.body.error.code).to.equal('RATE_LIMITED');
    });
    const audits = await (await app.getRepository(AuditLogRepository)).find({ where: { userId: user.id, action: 'USER_LOGIN_FAILED' } });
    expect(audits).to.have.length(3);
  });

  it('rejects passwords bcrypt would silently truncate', async () => {
    const response = await client.post('/api/auth/register').send({ email: 'long@example.test', password: '€'.repeat(30), name: 'L' }).expect(422);
    expect(response.body.error.code).to.equal('PASSWORD_TOO_LONG');
  });

  it('stops accepting a token once its account is deleted or disabled, or its sessions are revoked', async () => {
    const users = await app.getRepository(UserRepository);

    const deleted = await givenUser(client);
    await users.deleteById(deleted.id);
    expect((await client.get('/api/jobs').set(deleted.auth).expect(401)).body.error.code).to.equal('TOKEN_INVALID');

    const disabled = await givenUser(client);
    await users.updateById(disabled.id, { status: 'disabled' as never });
    expect((await client.get('/api/jobs').set(disabled.auth).expect(401)).body.error.code).to.equal('ACCOUNT_DISABLED');
    const relogin = await client.post('/api/auth/login').send({ email: disabled.email, password: 'correct horse battery' }).expect(401);
    expect(relogin.body.error.code).to.equal('ACCOUNT_DISABLED');

    const revoked = await givenUser(client);
    await client.post('/api/auth/sign-out-everywhere').set(revoked.auth).expect(204);
    expect((await client.get('/api/auth/me').set(revoked.auth).expect(401)).body.error.code).to.equal('TOKEN_INVALID');
    const fresh = (await client.post('/api/auth/login').send({ email: revoked.email, password: 'correct horse battery' }).expect(200)).body.data.token;
    await client.get('/api/auth/me').set({ Authorization: `Bearer ${fresh}` }).expect(200);
  });

  it('sends security headers and hides the framework', async () => {
    const response = await client.get('/api/health');
    expect(response.headers['x-content-type-options']).to.equal('nosniff');
    expect(response.headers['x-frame-options']).to.equal('DENY');
    expect(response.headers['referrer-policy']).to.equal('no-referrer');
    expect(response.headers['x-powered-by']).to.be.undefined();
  });
});
