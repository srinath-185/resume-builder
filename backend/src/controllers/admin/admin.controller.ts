import { authenticate } from '@loopback/authentication';
import { inject } from '@loopback/core';
import { get, param, patch, post, requestBody } from '@loopback/rest';
import { SecurityBindings, UserProfile } from '@loopback/security';
import { currentUserId, currentUserRole } from '../../authentication/jwt.strategy';
import { PaginatedResult, parsePage } from '../../common/utils/list-query.util';
import { AuditLog, UserRole, UserStatus } from '../../models';
import { Actor, AdminService, AdminUserView, CreateUserInput, LlmUsageSummary } from '../../services/admin/admin.service';
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH } from '../../services/auth/auth.service';

function actorOf(profile: UserProfile): Actor {
  return { id: currentUserId(profile), role: currentUserRole(profile) };
}

function enumOrUndefined<T extends string>(value: string | undefined, values: T[]): T | undefined {
  return value && (values as string[]).includes(value) ? (value as T) : undefined;
}

/** Every route here needs an admin or superadmin; a test asserts that for each /admin path. */
@authenticate('jwt-admin')
export class AdminController {
  constructor(@inject('services.AdminService') private admin: AdminService) {}

  @get('/admin/users')
  listUsers(
    @param.query.string('q') q?: string,
    @param.query.string('role') role?: string,
    @param.query.string('status') status?: string,
    @param.query.number('page') page?: number,
    @param.query.number('limit') limit?: number,
  ): Promise<PaginatedResult<AdminUserView>> {
    return this.admin.listUsers(
      { q, role: enumOrUndefined(role, Object.values(UserRole)), status: enumOrUndefined(status, Object.values(UserStatus)) },
      parsePage(page, limit),
    );
  }

  @get('/admin/users/{id}')
  getUser(@param.path.string('id') id: string): Promise<AdminUserView> {
    return this.admin.getUser(id);
  }

  @post('/admin/users')
  createUser(
    @inject(SecurityBindings.USER) profile: UserProfile,
    @requestBody({
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['email', 'name', 'password'],
            additionalProperties: false,
            properties: {
              email: { type: 'string', format: 'email', maxLength: 254 },
              name: { type: 'string', minLength: 1, maxLength: 120 },
              password: { type: 'string', minLength: MIN_PASSWORD_LENGTH, maxLength: MAX_PASSWORD_BYTES },
              role: { type: 'string', enum: Object.values(UserRole) },
            },
          },
        },
      },
    })
    body: CreateUserInput,
  ): Promise<AdminUserView> {
    return this.admin.createUser(actorOf(profile), body);
  }

  @patch('/admin/users/{id}/status')
  setStatus(
    @inject(SecurityBindings.USER) profile: UserProfile,
    @param.path.string('id') id: string,
    @requestBody({
      content: {
        'application/json': {
          schema: { type: 'object', required: ['status'], additionalProperties: false, properties: { status: { type: 'string', enum: Object.values(UserStatus) } } },
        },
      },
    })
    body: { status: UserStatus },
  ): Promise<AdminUserView> {
    return this.admin.setStatus(actorOf(profile), id, body.status);
  }

  @patch('/admin/users/{id}/role')
  @authenticate('jwt-superadmin')
  setRole(
    @inject(SecurityBindings.USER) profile: UserProfile,
    @param.path.string('id') id: string,
    @requestBody({
      content: {
        'application/json': {
          schema: { type: 'object', required: ['role'], additionalProperties: false, properties: { role: { type: 'string', enum: Object.values(UserRole) } } },
        },
      },
    })
    body: { role: UserRole },
  ): Promise<AdminUserView> {
    return this.admin.setRole(actorOf(profile), id, body.role);
  }

  @post('/admin/users/{id}/revoke-sessions')
  async revokeSessions(@inject(SecurityBindings.USER) profile: UserProfile, @param.path.string('id') id: string): Promise<void> {
    await this.admin.revokeSessions(actorOf(profile), id);
  }

  @get('/admin/audit-logs')
  auditLogs(
    @param.query.string('userId') userId?: string,
    @param.query.string('action') action?: string,
    @param.query.string('entity') entity?: string,
    @param.query.number('page') page?: number,
    @param.query.number('limit') limit?: number,
  ): Promise<PaginatedResult<AuditLog>> {
    return this.admin.listAuditLogs({ userId, action, entity }, parsePage(page, limit));
  }

  @get('/admin/llm-usage')
  llmUsage(@param.query.number('days') days?: number): Promise<LlmUsageSummary> {
    return this.admin.llmUsage(days ?? 1);
  }
}
