import { model, property } from '@loopback/repository';
import { OwnedEntity } from '../base/timestamped-entity.model';

export enum PortalSessionStatus {
  VALID = 'VALID',
  EXPIRED = 'EXPIRED',
}

/** A user's own logged-in session cookies for a portal (LinkedIn Easy Apply). Encrypted; never returned. */
@model({
  settings: {
    strict: true,
    hiddenProperties: ['encryptedCookies'],
    mongodb: { collection: 'portal_sessions' },
    indexes: { uniqueUserPortal: { keys: { userId: 1, portal: 1 }, options: { unique: true } } },
  },
})
export class PortalSession extends OwnedEntity {
  @property({ type: 'string', required: true })
  portal: string;

  @property({ type: 'string', required: true })
  encryptedCookies: string;

  @property({ type: 'number', default: 0 })
  cookieCount: number;

  @property({ type: 'string', required: true, jsonSchema: { enum: Object.values(PortalSessionStatus) } })
  status: PortalSessionStatus;

  @property({ type: 'date' })
  lastUsedAt?: Date;

  constructor(data?: Partial<PortalSession>) {
    super(data);
  }
}
