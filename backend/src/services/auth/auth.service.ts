import { BindingScope, inject, injectable } from '@loopback/core';
import bcrypt from 'bcryptjs';
import { envInt, envString } from '../../common/config/env.util';
import { AppAuthenticationError, AppAuthorizationError, AppConflictError, AppValidationError, ERROR_CODES } from '../../common/errors';
import { PublicUser, statusOf, tokenVersionOf, toPublicUser, User, UserRole, UserStatus } from '../../models';
import { normaliseEmail, UserRepository } from '../../repositories';
import { AuditService } from '../audit/audit.service';
import { RateLimitService, RateRule } from '../common/rate-limit.service';
import { JwtService } from './jwt.service';

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResult {
  token: string;
  user: PublicUser;
}

export interface NewAccount extends RegisterInput {
  role?: UserRole;
}

export type RegistrationMode = 'open' | 'closed';

export const MIN_PASSWORD_LENGTH = 8;
/** bcrypt ignores everything after 72 bytes, so a longer password would be silently truncated. */
export const MAX_PASSWORD_BYTES = 72;

function bcryptRounds(): number {
  return envInt('BCRYPT_ROUNDS', 12);
}

// Compared against when the email is unknown, so a miss costs as much as a hit.
// Hashed at the configured cost: a cheaper dummy would make unknown emails answer faster.
const dummyHashes = new Map<number, Promise<string>>();
function dummyHash(): Promise<string> {
  const rounds = bcryptRounds();
  if (!dummyHashes.has(rounds)) dummyHashes.set(rounds, bcrypt.hash('not-a-real-password', rounds));
  return dummyHashes.get(rounds)!;
}

/** `open` lets anyone sign up; `closed` leaves account creation to admins. Production defaults to closed. */
export function registrationMode(): RegistrationMode {
  const fallback = process.env.NODE_ENV === 'production' ? 'closed' : 'open';
  return envString('REGISTRATION_MODE', fallback) === 'open' ? 'open' : 'closed';
}

function loginFailuresPerEmail(): RateRule {
  return { limit: envInt('LOGIN_MAX_FAILURES_PER_EMAIL', 10), windowSeconds: envInt('LOGIN_LOCKOUT_SECONDS', 900) };
}

function loginFailuresPerIp(): RateRule {
  return { limit: envInt('LOGIN_MAX_FAILURES_PER_IP', 100), windowSeconds: envInt('LOGIN_LOCKOUT_SECONDS', 900) };
}

function registrationsPerIp(): RateRule {
  return { limit: envInt('REGISTER_MAX_PER_IP', 10), windowSeconds: 3600 };
}

export function assertPasswordAcceptable(password: string, minLength = MIN_PASSWORD_LENGTH): void {
  if (password.length < minLength) {
    throw new AppValidationError(ERROR_CODES.PASSWORD_TOO_WEAK, `Password must be at least ${minLength} characters`);
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new AppValidationError(ERROR_CODES.PASSWORD_TOO_LONG, `Password must be at most ${MAX_PASSWORD_BYTES} bytes`);
  }
}

@injectable({ scope: BindingScope.TRANSIENT })
export class AuthService {
  constructor(
    @inject('repositories.UserRepository') private users: UserRepository,
    @inject('services.JwtService') private jwtService: JwtService,
    @inject('services.AuditService') private audit: AuditService,
    @inject('services.RateLimitService') private rateLimits: RateLimitService,
  ) {}

  /** Self-service sign-up. Always creates a plain user; roles are granted only by an admin. */
  async register(input: RegisterInput, clientIp: string): Promise<AuthResult> {
    if (registrationMode() !== 'open') {
      throw new AppAuthorizationError(ERROR_CODES.REGISTRATION_CLOSED, 'Sign-up is closed on this server; ask an administrator for an account');
    }
    await this.rateLimits.consume(`register:ip:${clientIp}`, registrationsPerIp());
    const user = await this.createAccount({ email: input.email, password: input.password, name: input.name });
    await this.audit.record({ userId: user.id, action: 'USER_REGISTERED', entity: 'User', entityId: user.id, after: { email: user.email, name: user.name } });
    return this.issue(user);
  }

  /** Shared by sign-up, the admin API and the create-superadmin script. */
  async createAccount(input: NewAccount, minPasswordLength = MIN_PASSWORD_LENGTH): Promise<User> {
    const email = normaliseEmail(input.email);
    const name = input.name.trim();
    assertPasswordAcceptable(input.password, minPasswordLength);
    if (!name) throw new AppValidationError(ERROR_CODES.VALIDATION_ERROR, 'Name is required');
    if (await this.users.findByEmail(email)) {
      throw new AppConflictError(ERROR_CODES.EMAIL_TAKEN, 'An account with this email already exists');
    }
    const passwordHash = await this.hashPassword(input.password);
    return this.users.create({ email, name, passwordHash, role: input.role ?? UserRole.USER, status: UserStatus.ACTIVE, tokenVersion: 0 });
  }

  hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, bcryptRounds());
  }

  async login(input: LoginInput, clientIp: string): Promise<AuthResult> {
    const email = normaliseEmail(input.email);
    const emailKey = `login:email:${email}`;
    const ipKey = `login:ip:${clientIp}`;
    await this.rateLimits.assertUnder(emailKey, loginFailuresPerEmail());
    await this.rateLimits.assertUnder(ipKey, loginFailuresPerIp());

    const user = await this.users.findByEmail(email);
    const valid = await bcrypt.compare(input.password, user?.passwordHash ?? (await dummyHash()));
    if (!user || !valid) {
      await this.rateLimits.record(emailKey, loginFailuresPerEmail());
      await this.rateLimits.record(ipKey, loginFailuresPerIp());
      if (user) await this.audit.record({ userId: user.id, action: 'USER_LOGIN_FAILED', entity: 'User', entityId: user.id, meta: { ip: clientIp } });
      throw new AppAuthenticationError(ERROR_CODES.INVALID_CREDENTIALS, 'Email or password is incorrect');
    }
    // Only revealed after the right password, so it tells a guesser nothing.
    if (statusOf(user) === UserStatus.DISABLED) {
      throw new AppAuthenticationError(ERROR_CODES.ACCOUNT_DISABLED, 'This account has been disabled');
    }
    await this.rateLimits.reset(emailKey);
    await this.users.updateById(user.id!, { lastLoginAt: new Date() });
    await this.audit.record({ userId: user.id, action: 'USER_LOGGED_IN', entity: 'User', entityId: user.id, meta: { ip: clientIp } });
    return this.issue(user);
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId).catch(() => null);
    if (!user) throw new AppAuthenticationError(ERROR_CODES.TOKEN_INVALID, 'Account no longer exists');
    return toPublicUser(user);
  }

  /** Revokes every token issued to this user so far. */
  async signOutEverywhere(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    await this.users.updateById(userId, { tokenVersion: tokenVersionOf(user) + 1 });
    await this.audit.record({ userId, action: 'USER_SIGNED_OUT_EVERYWHERE', entity: 'User', entityId: userId });
  }

  private issue(user: User): AuthResult {
    const publicUser = toPublicUser(user);
    return { token: this.jwtService.sign(publicUser, tokenVersionOf(user)), user: publicUser };
  }
}
