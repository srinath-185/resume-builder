import { Client } from '@loopback/testlab';

export interface TestUser {
  id: string;
  email: string;
  token: string;
  auth: { Authorization: string };
}

let counter = 0;

/** Registers a fresh user and returns a ready-to-use Authorization header. */
export async function givenUser(client: Client, name = 'Test User'): Promise<TestUser> {
  counter++;
  const email = `user${counter}-${Date.now()}@example.test`;
  const response = await client.post('/api/auth/register').send({ email, password: 'correct horse battery', name }).expect(200);
  const { token, user } = response.body.data;
  return { id: user.id, email, token, auth: { Authorization: `Bearer ${token}` } };
}
