import { model, property } from '@loopback/repository';
import { OwnedEntity } from '../base/timestamped-entity.model';

export enum HiringPostStatus {
  NEW = 'NEW',
  CONTACTED = 'CONTACTED',
  IGNORED = 'IGNORED',
}

/** A public "we're hiring" post found by the hiring-post query. */
@model({
  settings: {
    strict: true,
    mongodb: { collection: 'hiring_posts' },
    indexes: { uniqueUrl: { keys: { userId: 1, postUrl: 1 }, options: { unique: true } } },
  },
})
export class HiringPost extends OwnedEntity {
  @property({ type: 'string', required: true })
  source: string;

  @property({ type: 'string', required: true })
  postUrl: string;

  @property({ type: 'string' })
  author?: string;

  @property({ type: 'string' })
  authorUrl?: string;

  @property({ type: 'string', default: '' })
  text: string;

  @property.array(String, { default: [] })
  extractedEmails: string[];

  @property({ type: 'string', required: true })
  queryUsed: string;

  /** The target title the query was built from. */
  @property({ type: 'string' })
  title?: string;

  @property({ type: 'date' })
  postedAt?: Date;

  @property({ type: 'string', required: true, jsonSchema: { enum: Object.values(HiringPostStatus) } })
  status: HiringPostStatus;

  constructor(data?: Partial<HiringPost>) {
    super(data);
  }
}

export enum ContactSource {
  POST = 'POST',
  JOB = 'JOB',
  MANUAL = 'MANUAL',
}

/** A person the user may email. `doNotContact` is permanent and checked before every send. */
@model({
  settings: {
    strict: true,
    mongodb: { collection: 'recruiter_contacts' },
    indexes: { uniqueEmail: { keys: { userId: 1, email: 1 }, options: { unique: true } } },
  },
})
export class RecruiterContact extends OwnedEntity {
  @property({ type: 'string', required: true, jsonSchema: { format: 'email' } })
  email: string;

  @property({ type: 'string' })
  name?: string;

  @property({ type: 'string' })
  company?: string;

  @property({ type: 'string', required: true, jsonSchema: { enum: Object.values(ContactSource) } })
  source: ContactSource;

  /** HiringPost or JobListing id the contact came from. */
  @property({ type: 'string' })
  sourceId?: string;

  @property({ type: 'boolean', default: false })
  doNotContact: boolean;

  @property({ type: 'date' })
  lastContactedAt?: Date;

  constructor(data?: Partial<RecruiterContact>) {
    super(data);
  }
}
