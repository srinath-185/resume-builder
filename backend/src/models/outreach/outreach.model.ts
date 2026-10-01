import { model, property } from '@loopback/repository';
import { OwnedEntity } from '../base/timestamped-entity.model';

export enum MailProvider {
  GMAIL = 'GMAIL',
  SMTP = 'SMTP',
}

export enum MailConnectorStatus {
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

/**
 * The user's own mailbox used to send outreach. The secret (Gmail refresh
 * token or SMTP password) is stored AES-GCM encrypted and never returned.
 */
@model({
  settings: {
    strict: true,
    hiddenProperties: ['encryptedSecret'],
    mongodb: { collection: 'mail_connectors' },
    indexes: { uniqueUser: { keys: { userId: 1 }, options: { unique: true } } },
  },
})
export class MailConnector extends OwnedEntity {
  @property({ type: 'string', required: true, jsonSchema: { enum: Object.values(MailProvider) } })
  provider: MailProvider;

  @property({ type: 'string', required: true })
  senderEmail: string;

  @property({ type: 'string' })
  senderName?: string;

  @property({ type: 'string', required: true })
  encryptedSecret: string;

  @property({ type: 'string', required: true, jsonSchema: { enum: Object.values(MailConnectorStatus) } })
  status: MailConnectorStatus;

  @property({ type: 'string' })
  lastError?: string;

  @property({ type: 'date' })
  lastUsedAt?: Date;

  constructor(data?: Partial<MailConnector>) {
    super(data);
  }
}

@model({
  settings: {
    strict: true,
    mongodb: { collection: 'outreach_templates' },
    indexes: { byUser: { keys: { userId: 1, createdAt: -1 } } },
  },
})
export class OutreachTemplate extends OwnedEntity {
  @property({ type: 'string', required: true })
  name: string;

  @property({ type: 'string', required: true })
  subject: string;

  @property({ type: 'string', required: true })
  body: string;

  @property({ type: 'boolean', default: false })
  isDefault: boolean;

  constructor(data?: Partial<OutreachTemplate>) {
    super(data);
  }
}

export enum OutreachStatus {
  DRAFT = 'DRAFT',
  QUEUED = 'QUEUED',
  SENT = 'SENT',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/** One email to one recruiter. Drafts are always reviewed; nothing is sent without the user pressing Send. */
@model({
  settings: {
    strict: true,
    mongodb: { collection: 'outreach_messages' },
    indexes: {
      byUser: { keys: { userId: 1, createdAt: -1 } },
      followUps: { keys: { status: 1, followUpDueAt: 1 } },
    },
  },
})
export class OutreachMessage extends OwnedEntity {
  @property({ type: 'string', required: true, mongodb: { dataType: 'ObjectId' } })
  contactId: string;

  @property({ type: 'string', required: true })
  toEmail: string;

  @property({ type: 'string', required: true, mongodb: { dataType: 'ObjectId' } })
  applicationId: string;

  @property({ type: 'string' })
  hiringPostId?: string;

  @property({ type: 'string' })
  templateId?: string;

  @property({ type: 'string', required: true })
  subject: string;

  @property({ type: 'string', required: true })
  body: string;

  /** Name the approved resume is attached under. */
  @property({ type: 'string' })
  attachmentName?: string;

  @property({ type: 'string', required: true, jsonSchema: { enum: Object.values(OutreachStatus) } })
  status: OutreachStatus;

  /** 1 = first email, 2 = follow-up. */
  @property({ type: 'number', default: 1 })
  sequence: number;

  @property({ type: 'string' })
  followUpOf?: string;

  @property({ type: 'string' })
  provider?: string;

  @property({ type: 'string' })
  messageId?: string;

  @property({ type: 'string' })
  threadId?: string;

  @property({ type: 'date' })
  sentAt?: Date;

  @property({ type: 'date' })
  followUpDueAt?: Date;

  @property({ type: 'boolean', default: false })
  followUpCreated: boolean;

  @property({ type: 'string' })
  error?: string;

  constructor(data?: Partial<OutreachMessage>) {
    super(data);
  }
}
