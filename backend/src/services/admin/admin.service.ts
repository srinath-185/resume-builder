import { BindingScope, inject, injectable } from '@loopback/core';
import { Where } from '@loopback/repository';
import { AppAuthorizationError, AppNotFoundError, AppValidationError, ERROR_CODES } from '../../common/errors';
import { PageRequest, PaginatedResult, toPaginated } from '../../common/utils/list-query.util';
import { escapeRegex } from '../../domain/keyword-match';
import { AuditLog, isAdminRole, roleOf, statusOf, tokenVersionOf, User, UserRole, UserStatus } from '../../models';
import { AuditLogRepository, LlmUsageLogRepository, normaliseEmail, UserRepository } from '../../repositories';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';

/** The calling admin, as authenticated on this request. */
export interface Actor {
  id: string;
  role: UserRole;
}

/** What an admin may see about an account: identity and state, never resume content or connector secrets. */
export interface AdminUserView {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt?: Date;
  createdAt?: Date;
}

export interface UserFilters {
  q?: string;
  role?: UserRole;
  status?: UserStatus;
}

export interface AuditFilters {
  userId?: string;
  action?: string;
  entity?: string;
}

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  role?: UserRole;
}

export interface UsageTotals {
  calls: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmUsageSummary {
  since: Date;
  byProvider: Array<UsageTotals & { provider: string }>;
  byUser: Array<UsageTotals & { userId: string; email?: string }>;
}

/** Superadmins need a longer password than self-service accounts. */
export const MIN_ADMIN_PASSWORD_LENGTH = 12;
const MAX_USAGE_ROWS = 100_000;
const TOP_USERS = 50;

function toView(user: User): AdminUserView {
  return { id: user.id!, email: user.email, name: user.name, role: roleOf(user), status: statusOf(user), lastLoginAt: user.lastLoginAt, createdAt: user.createdAt };
}

function emptyTotals(): UsageTotals {
  return { calls: 0, failures: 0, inputTokens: 0, outputTokens: 0 };
}

/**
 * Account administration. Rules:
 * - nobody changes their own role or status (so the last superadmin cannot lock everyone out);
 * - only a superadmin acts on admin or superadmin accounts, or grants a role;
 * - disabling an account or changing its role revokes its sessions;
 * - every change is audited under the acting admin's id.
 */
@injectable({ scope: BindingScope.TRANSIENT })
export class AdminService {
  constructor(
    @inject('repositories.UserRepository') private users: UserRepository,
    @inject('repositories.AuditLogRepository') private auditLogRepo: AuditLogRepository,
    @inject('repositories.LlmUsageLogRepository') private usageLogs: LlmUsageLogRepository,
    @inject('services.AuthService') private auth: AuthService,
    @inject('services.AuditService') private audit: AuditService,
  ) {}

  async listUsers(filters: UserFilters, page: PageRequest): Promise<PaginatedResult<AdminUserView>> {
    const clauses: Where<User>[] = [];
    if (filters.q?.trim()) {
      const pattern = new RegExp(escapeRegex(filters.q.trim().slice(0, 80)), 'i');
      clauses.push({ or: [{ email: { regexp: pattern } }, { name: { regexp: pattern } }] });
    }
    if (filters.role) clauses.push({ role: filters.role });
    if (filters.status) clauses.push({ status: filters.status });
    const where: Where<User> = clauses.length ? { and: clauses } : {};
    const [items, { count }] = await Promise.all([
      this.users.find({ where, order: ['createdAt DESC'], skip: page.skip, limit: page.limit }),
      this.users.count(where),
    ]);
    return toPaginated(items.map(toView), count, page);
  }

  async getUser(id: string): Promise<AdminUserView> {
    return toView(await this.findUser(id));
  }

  async createUser(actor: Actor, input: CreateUserInput): Promise<AdminUserView> {
    const role = input.role ?? UserRole.USER;
    if (role !== UserRole.USER && actor.role !== UserRole.SUPERADMIN) {
      throw new AppAuthorizationError(ERROR_CODES.FORBIDDEN, 'Only a superadmin can create admin accounts');
    }
    const user = await this.auth.createAccount({ ...input, role }, isAdminRole(role) ? MIN_ADMIN_PASSWORD_LENGTH : undefined);
    await this.audit.record({ userId: actor.id, action: 'ADMIN_USER_CREATED', entity: 'User', entityId: user.id, after: { email: user.email, name: user.name, role } });
    return toView(user);
  }

  async setStatus(actor: Actor, id: string, status: UserStatus): Promise<AdminUserView> {
    const target = await this.findManageable(actor, id);
    const before = statusOf(target);
    if (before === status) return toView(target);
    // Disabling revokes existing tokens; re-enabling does not resurrect them.
    const tokenVersion = status === UserStatus.DISABLED ? tokenVersionOf(target) + 1 : tokenVersionOf(target);
    await this.users.updateById(id, { status, tokenVersion });
    await this.audit.record({
      userId: actor.id,
      action: status === UserStatus.DISABLED ? 'ADMIN_USER_DISABLED' : 'ADMIN_USER_ENABLED',
      entity: 'User',
      entityId: id,
      before: { status: before },
      after: { status },
    });
    return this.getUser(id);
  }

  async setRole(actor: Actor, id: string, role: UserRole): Promise<AdminUserView> {
    if (actor.role !== UserRole.SUPERADMIN) throw new AppAuthorizationError(ERROR_CODES.FORBIDDEN, 'Only a superadmin can change roles');
    const target = await this.findManageable(actor, id);
    const before = roleOf(target);
    if (before === role) return toView(target);
    // A new role means a different token lifetime and different access: start a fresh session.
    await this.users.updateById(id, { role, tokenVersion: tokenVersionOf(target) + 1 });
    await this.audit.record({ userId: actor.id, action: 'ADMIN_ROLE_CHANGED', entity: 'User', entityId: id, before: { role: before }, after: { role } });
    return this.getUser(id);
  }

  async revokeSessions(actor: Actor, id: string): Promise<void> {
    const target = await this.findManageable(actor, id);
    await this.users.updateById(id, { tokenVersion: tokenVersionOf(target) + 1 });
    await this.audit.record({ userId: actor.id, action: 'ADMIN_SESSIONS_REVOKED', entity: 'User', entityId: id });
  }

  async listAuditLogs(filters: AuditFilters, page: PageRequest): Promise<PaginatedResult<AuditLog>> {
    const clauses: Where<AuditLog>[] = [];
    if (filters.userId) clauses.push({ userId: filters.userId });
    if (filters.action) clauses.push({ action: filters.action });
    if (filters.entity) clauses.push({ entity: filters.entity });
    const where: Where<AuditLog> = clauses.length ? { and: clauses } : {};
    const [items, { count }] = await Promise.all([
      this.auditLogRepo.find({ where, order: ['createdAt DESC'], skip: page.skip, limit: page.limit }),
      this.auditLogRepo.count(where),
    ]);
    return toPaginated(items, count, page);
  }

  /** AI usage across all users, so an admin can see who is spending the shared free-tier quota. */
  async llmUsage(days: number): Promise<LlmUsageSummary> {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (Math.min(30, Math.max(1, Math.floor(days))) - 1));
    const logs = await this.usageLogs.find({
      where: { createdAt: { gte: since } },
      fields: { userId: true, provider: true, success: true, inputTokens: true, outputTokens: true },
      limit: MAX_USAGE_ROWS,
    });

    const byProvider = new Map<string, UsageTotals & { provider: string }>();
    const byUser = new Map<string, UsageTotals & { userId: string; email?: string }>();
    for (const log of logs) {
      const providerRow = byProvider.get(log.provider) ?? { provider: log.provider, ...emptyTotals() };
      byProvider.set(log.provider, providerRow);
      const rows: UsageTotals[] = [providerRow];
      if (log.userId) {
        const userRow = byUser.get(log.userId) ?? { userId: log.userId, ...emptyTotals() };
        byUser.set(log.userId, userRow);
        rows.push(userRow);
      }
      for (const row of rows) {
        row.calls++;
        if (!log.success) row.failures++;
        row.inputTokens += log.inputTokens ?? 0;
        row.outputTokens += log.outputTokens ?? 0;
      }
    }

    const topUsers = [...byUser.values()].sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens)).slice(0, TOP_USERS);
    const emails = new Map(
      (await this.users.find({ where: { id: { inq: topUsers.map(row => row.userId) } }, fields: { id: true, email: true } })).map(user => [String(user.id), user.email]),
    );
    return { since, byProvider: [...byProvider.values()], byUser: topUsers.map(row => ({ ...row, email: emails.get(row.userId) })) };
  }

  /**
   * Used by the create-superadmin script: promotes an existing account, or
   * creates one with a password supplied only when it is actually needed.
   */
  async bootstrapSuperadmin(email: string, name: string, askPassword: () => Promise<string>): Promise<{ user: AdminUserView; created: boolean }> {
    const existing = await this.users.findByEmail(normaliseEmail(email));
    if (existing) {
      await this.users.updateById(existing.id!, { role: UserRole.SUPERADMIN, status: UserStatus.ACTIVE, tokenVersion: tokenVersionOf(existing) + 1 });
      await this.audit.record({ action: 'SUPERADMIN_BOOTSTRAPPED', entity: 'User', entityId: existing.id, before: { role: roleOf(existing) }, after: { role: UserRole.SUPERADMIN }, meta: { via: 'cli' } });
      return { user: await this.getUser(existing.id!), created: false };
    }
    const user = await this.auth.createAccount({ email, name, password: await askPassword(), role: UserRole.SUPERADMIN }, MIN_ADMIN_PASSWORD_LENGTH);
    await this.audit.record({ action: 'SUPERADMIN_BOOTSTRAPPED', entity: 'User', entityId: user.id, after: { email: user.email, role: UserRole.SUPERADMIN }, meta: { via: 'cli' } });
    return { user: toView(user), created: true };
  }

  private async findUser(id: string): Promise<User> {
    const user = await this.users.findById(id).catch(() => null);
    if (!user) throw new AppNotFoundError(ERROR_CODES.USER_NOT_FOUND, 'User not found');
    return user;
  }

  private async findManageable(actor: Actor, id: string): Promise<User> {
    if (actor.id === id) throw new AppValidationError(ERROR_CODES.ADMIN_SELF_CHANGE, 'You cannot change your own account here');
    const target = await this.findUser(id);
    if (isAdminRole(roleOf(target)) && actor.role !== UserRole.SUPERADMIN) {
      throw new AppAuthorizationError(ERROR_CODES.FORBIDDEN, 'Only a superadmin can manage admin accounts');
    }
    return target;
  }
}
