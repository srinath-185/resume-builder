import { Client, expect } from '@loopback/testlab';
import { ResumeBuilderApplication } from '../../application';
import { AuditLogRepository } from '../../repositories';
import { givenUser } from '../helpers/auth.helper';
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
    expect(me.body.data).to.eql({ id: user.id, email: user.email, name: 'Ada' });
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
});
