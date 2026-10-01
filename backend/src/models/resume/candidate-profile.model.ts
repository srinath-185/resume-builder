import { model, property } from '@loopback/repository';
import { OwnedEntity } from '../base/timestamped-entity.model';

export interface DailyCaps {
  tailor: number;
  apply: number;
  outreach: number;
}

export const DEFAULT_DAILY_CAPS: DailyCaps = { tailor: 10, apply: 15, outreach: 10 };
export const DEFAULT_AUTO_TAILOR_THRESHOLD = 75;

/** What the user is looking for. One per user; seeded from the first parsed resume. */
@model({
  settings: {
    strict: true,
    mongodb: { collection: 'candidate_profiles' },
    indexes: { uniqueUser: { keys: { userId: 1 }, options: { unique: true } } },
  },
})
export class CandidateProfile extends OwnedEntity {
  @property.array(String, { default: [] })
  targetTitles: string[];

  @property.array(String, { default: [] })
  skills: string[];

  @property({ type: 'number' })
  yearsExperience?: number;

  /** Empty means "anywhere"; the hiring-post query then omits the location term. */
  @property({ type: 'string' })
  location?: string;

  @property({ type: 'boolean', default: false })
  remoteOnly: boolean;

  @property({ type: 'string' })
  seniority?: string;

  /** Match score (0–100) at or above which a tailored resume is drafted automatically. */
  @property({ type: 'number', default: DEFAULT_AUTO_TAILOR_THRESHOLD, jsonSchema: { minimum: 0, maximum: 101 } })
  autoTailorThreshold: number;

  @property({ type: 'object', default: DEFAULT_DAILY_CAPS })
  dailyCaps: DailyCaps;

  @property({ type: 'string' })
  primaryResumeId?: string;

  @property({ type: 'string' })
  defaultTemplateId?: string;

  /** LinkedIn-style query for hiring posts; {title} and optional {location}. Empty = default. */
  @property({ type: 'string' })
  hiringQueryTemplate?: string;

  constructor(data?: Partial<CandidateProfile>) {
    super(data);
  }
}
