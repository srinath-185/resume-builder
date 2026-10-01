import { BindingScope, inject, injectable } from '@loopback/core';
import { redactSecrets } from '../../common/utils/redact.util';
import { AuditLogRepository } from '../../repositories';
import { LoggerService } from '../common/logger.service';

export interface AuditEntry {
  userId?: string;
  /** Verb in SCREAMING_SNAKE, e.g. RESUME_UPLOADED, VARIANT_APPROVED. */
  action: string;
  entity: string;
  entityId?: string;
  before?: object;
  after?: object;
  meta?: object;
}

/**
 * Writes the append-only audit trail. Called by mutation services after the
 * state change. Values are redacted first so secrets never reach the trail.
 */
@injectable({ scope: BindingScope.TRANSIENT })
export class AuditService {
  constructor(
    @inject('repositories.AuditLogRepository') private auditLogs: AuditLogRepository,
    @inject('services.LoggerService') private logger: LoggerService,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.auditLogs.create({
        userId: entry.userId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        before: entry.before ? redactSecrets(entry.before) : undefined,
        after: entry.after ? redactSecrets(entry.after) : undefined,
        meta: entry.meta ? redactSecrets(entry.meta) : undefined,
      });
    } catch (error) {
      // The mutation already happened; failing the request now would lie about it.
      this.logger.error('Audit write failed', error, { action: entry.action, entity: entry.entity, entityId: entry.entityId });
    }
  }

  list(userId: string, limit = 50) {
    return this.auditLogs.find({ where: { userId }, order: ['createdAt DESC'], limit });
  }
}
