import { BindingScope, inject, injectable } from '@loopback/core';
import bcrypt from 'bcryptjs';
import { envInt } from '../../common/config/env.util';
import { AppAuthenticationError, AppConflictError, AppValidationError, ERROR_CODES } from '../../common/errors';
import { PublicUser, toPublicUser } from '../../models';
import { normaliseEmail, UserRepository } from '../../repositories';
import { AuditService } from '../audit/audit.service';
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

export const MIN_PASSWORD_LENGTH = 8;
// Compared against when the email is unknown, so a miss costs as much as a hit.
const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8.z6x4cO3sD0F1lZ/6G6xjVv7.5Q2e';

@injectable({ scope: BindingScope.TRANSIENT })
export class AuthService {
  constructor(
    @inject('repositories.UserRepository') private users: UserRepository,
    @inject('services.JwtService') private jwtService: JwtService,
    @inject('services.AuditService') private audit: AuditService,
  ) {}

  async register(input: RegisterInput): Promise<AuthResult> {
    const email = normaliseEmail(input.email);
    const name = input.name.trim();
    if (input.password.length < MIN_PASSWORD_LENGTH) {
      throw new AppValidationError(ERROR_CODES.PASSWORD_TOO_WEAK, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    if (!name) throw new AppValidationError(ERROR_CODES.VALIDATION_ERROR, 'Name is required');
    if (await this.users.findByEmail(email)) {
      throw new AppConflictError(ERROR_CODES.EMAIL_TAKEN, 'An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(input.password, envInt('BCRYPT_ROUNDS', 10));
    const user = await this.users.create({ email, name, passwordHash });
    await this.audit.record({ userId: user.id, action: 'USER_REGISTERED', entity: 'User', entityId: user.id, after: { email, name } });
    return this.issue(toPublicUser(user));
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const user = await this.users.findByEmail(input.email);
    const valid = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) {
      throw new AppAuthenticationError(ERROR_CODES.INVALID_CREDENTIALS, 'Email or password is incorrect');
    }
    await this.users.updateById(user.id!, { lastLoginAt: new Date() });
    await this.audit.record({ userId: user.id, action: 'USER_LOGGED_IN', entity: 'User', entityId: user.id });
    return this.issue(toPublicUser(user));
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId).catch(() => null);
    if (!user) throw new AppAuthenticationError(ERROR_CODES.TOKEN_INVALID, 'Account no longer exists');
    return toPublicUser(user);
  }

  private issue(user: PublicUser): AuthResult {
    return { token: this.jwtService.sign(user), user };
  }
}
