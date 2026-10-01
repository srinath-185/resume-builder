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

/** Runs `fn` with environment overrides, restoring the previous values afterwards. */
export async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(Object.keys(vars).map(key => [key, process.env[key]]));
  Object.assign(process.env, vars);
  for (const [key, value] of Object.entries(vars)) if (value === undefined) delete process.env[key];
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
