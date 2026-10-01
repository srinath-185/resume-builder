import { model, property } from '@loopback/repository';
import { TimestampedEntity } from '../base/timestamped-entity.model';

/** Append-only record of every mutation. Nothing in the API updates or deletes these. */
@model({
  settings: {
    strict: true,
    mongodb: { collection: 'audit_logs' },
    indexes: {
      userTime: { keys: { userId: 1, createdAt: -1 } },
      entity: { keys: { entity: 1, entityId: 1 } },
    },
  },
})
export class AuditLog extends TimestampedEntity {
  @property({ type: 'string' })
  userId?: string;

  @property({ type: 'string', required: true })
  action: string;

  @property({ type: 'string', required: true })
  entity: string;

  @property({ type: 'string' })
  entityId?: string;

  @property({ type: 'object' })
  before?: object;

  @property({ type: 'object' })
  after?: object;

  @property({ type: 'object' })
  meta?: object;

  constructor(data?: Partial<AuditLog>) {
    super(data);
  }
}
