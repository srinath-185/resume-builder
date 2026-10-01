/**
 * Creates the first superadmin, or promotes an existing account.
 *
 *   npm run admin:create -- --email you@example.com [--name "Your Name"]
 *
 * The password is prompted for (hidden) only when a new account is created,
 * and is never taken from the command line, where it would land in shell
 * history and process listings. When stdin is not a terminal the first line
 * of stdin is used, for automated provisioning.
 */
import 'dotenv/config';
import readline from 'readline';
import { Writable } from 'stream';
import { ResumeBuilderApplication } from '../application';
import { AppError } from '../common/errors';
import { MongoDataSource } from '../datasources';
import { AdminService, MIN_ADMIN_PASSWORD_LENGTH } from '../services/admin/admin.service';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function ask(question: string, hidden: boolean): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: process.stdin.isTTY });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
    muted = hidden;
  });
}

async function askPassword(): Promise<string> {
  if (!process.stdin.isTTY) return ask('', false);
  const password = await ask(`Password (at least ${MIN_ADMIN_PASSWORD_LENGTH} characters): `, true);
  const confirm = await ask('Repeat password: ', true);
  if (password !== confirm) throw new Error('Passwords do not match');
  return password;
}

async function main(): Promise<void> {
  const email = argument('email');
  if (!email) throw new Error('Usage: npm run admin:create -- --email you@example.com [--name "Your Name"]');
  const name = argument('name') ?? 'Super Admin';

  const app = new ResumeBuilderApplication();
  await app.boot();
  try {
    const admin = await app.get<AdminService>('services.AdminService');
    const { user, created } = await admin.bootstrapSuperadmin(email, name, askPassword);
    console.log(`${created ? 'Created' : 'Promoted'} superadmin ${user.email} (${user.id}).`);
    if (!created) console.log('Existing sessions for this account were signed out; sign in again to get admin access.');
  } finally {
    await (await app.get<MongoDataSource>('datasources.mongo')).disconnect();
  }
}

main().then(
  () => process.exit(0),
  error => {
    console.error(error instanceof AppError ? `${error.code}: ${error.message}` : (error as Error).message);
    process.exit(1);
  },
);
