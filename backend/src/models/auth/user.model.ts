import { model, property } from '@loopback/repository';
import { TimestampedEntity } from '../base/timestamped-entity.model';

export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
  SUPERADMIN = 'superadmin',
}

export enum UserStatus {
  ACTIVE = 'active',
  DISABLED = 'disabled',
}

export const ADMIN_ROLES: readonly UserRole[] = [UserRole.ADMIN, UserRole.SUPERADMIN];

@model({
  settings: {
    strict: true,
    hiddenProperties: ['passwordHash'],
    mongodb: { collection: 'users' },
    indexes: {
      uniqueEmail: { keys: { email: 1 }, options: { unique: true } },
      roleStatus: { keys: { role: 1, status: 1 } },
    },
  },
})
export class User extends TimestampedEntity {
  /** Always stored lower-cased and trimmed. */
  @property({ type: 'string', required: true, jsonSchema: { format: 'email' } })
  email: string;

  @property({ type: 'string', required: true })
  name: string;

  @property({ type: 'string', required: true })
  passwordHash: string;

  /** Never accepted from a client: set only by an admin, or by the create-superadmin script. */
  @property({ type: 'string', default: UserRole.USER, jsonSchema: { enum: Object.values(UserRole) } })
  role?: UserRole;

  @property({ type: 'string', default: UserStatus.ACTIVE, jsonSchema: { enum: Object.values(UserStatus) } })
  status?: UserStatus;

  /** Bumped to revoke every token issued so far (disable, role change, "sign out everywhere"). */
  @property({ type: 'number', default: 0 })
  tokenVersion?: number;

  @property({ type: 'date' })
  lastLoginAt?: Date;

  constructor(data?: Partial<User>) {
    super(data);
  }
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

/** Records created before roles existed have no role/status/tokenVersion; these read them safely. */
export function roleOf(user: Pick<User, 'role'>): UserRole {
  return user.role ?? UserRole.USER;
}

export function statusOf(user: Pick<User, 'status'>): UserStatus {
  return user.status ?? UserStatus.ACTIVE;
}

export function tokenVersionOf(user: Pick<User, 'tokenVersion'>): number {
  return user.tokenVersion ?? 0;
}

export function isAdminRole(role: UserRole | undefined): boolean {
  return role !== undefined && ADMIN_ROLES.includes(role);
}

export function toPublicUser(user: User): PublicUser {
  return { id: user.id!, email: user.email, name: user.name, role: roleOf(user) };
}
