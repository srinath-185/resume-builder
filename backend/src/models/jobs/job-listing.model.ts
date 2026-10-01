import { model, property } from '@loopback/repository';
import { OwnedEntity } from '../base/timestamped-entity.model';

export enum JobListingStatus {
  NEW = 'NEW',
  SHORTLISTED = 'SHORTLISTED',
  SKIPPED = 'SKIPPED',
}

export enum MatchStatus {
  PENDING = 'PENDING',
  /** Failed the cheap keyword pre-filter; never sent to a model. */
  FILTERED_OUT = 'FILTERED_OUT',
  SCORED = 'SCORED',
  FAILED = 'FAILED',
}

/** A job found for one user. The same posting seen on two portals is one listing (fingerprint). */
@model({
  settings: {
    strict: true,
    mongodb: { collection: 'job_listings' },
    indexes: {
      uniqueFingerprint: { keys: { userId: 1, fingerprint: 1 }, options: { unique: true } },
      byScore: { keys: { userId: 1, status: 1, matchScore: -1 } },
    },
  },
})
export class JobListing extends OwnedEntity {
  @property({ type: 'string', required: true })
  fingerprint: string;

  /** Every source that returned this job; the first one is `source`. */
  @property({ type: 'string', required: true })
  source: string;

  @property.array(String, { default: [] })
  seenOn: string[];

  @property({ type: 'string', required: true })
  externalId: string;

  @property({ type: 'string', required: true })
  title: string;

  @property({ type: 'string', required: true })
  company: string;

  @property({ type: 'string' })
  location?: string;

  @property({ type: 'boolean' })
  remote?: boolean;

  @property({ type: 'string', required: true })
  url: string;

  @property({ type: 'string' })
  applyUrl?: string;

  @property.array(Object, { default: [] })
  applyOptions: Array<{ publisher: string; url: string; isDirect?: boolean }>;

  @property({ type: 'string', default: '' })
  description: string;

  @property({ type: 'date' })
  postedAt?: Date;

  @property({ type: 'string' })
  employmentType?: string;

  @property({ type: 'string' })
  salary?: string;

  @property({ type: 'string', required: true, jsonSchema: { enum: Object.values(JobListingStatus) } })
  status: JobListingStatus;

  @property({ type: 'string', required: true, jsonSchema: { enum: Object.values(MatchStatus) } })
  matchStatus: MatchStatus;

  @property({ type: 'number' })
  keywordScore?: number;

  /** 0–100 from the model; only set when matchStatus is SCORED. */
  @property({ type: 'number' })
  matchScore?: number;

  @property({ type: 'string' })
  matchReason?: string;

  @property.array(String, { default: [] })
  matchedSkills: string[];

  @property.array(String, { default: [] })
  missingSkills: string[];

  constructor(data?: Partial<JobListing>) {
    super(data);
  }
}

/** Per-user on/off switch and last-run state for each connector. */
@model({
  settings: {
    strict: true,
    mongodb: { collection: 'job_source_settings' },
    indexes: { uniqueUserSource: { keys: { userId: 1, connectorKey: 1 }, options: { unique: true } } },
  },
})
export class JobSourceSetting extends OwnedEntity {
  @property({ type: 'string', required: true })
  connectorKey: string;

  @property({ type: 'boolean', default: true })
  enabled: boolean;

  @property({ type: 'date' })
  lastRunAt?: Date;

  @property({ type: 'number' })
  lastFound?: number;

  @property({ type: 'string' })
  lastError?: string;

  constructor(data?: Partial<JobSourceSetting>) {
    super(data);
  }
}
