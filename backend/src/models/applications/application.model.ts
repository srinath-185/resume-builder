import { model, property } from '@loopback/repository';
import { ApplicationStatus } from '../../domain/application-status';
import { FactCheckResult } from '../../domain/resume-fact-check';
import { KeywordCoverage, ResumeChange } from '../../domain/resume-diff';
import { ResumeDocument } from '../../domain/resume-document';
import { OwnedEntity, TimestampedEntity } from '../base/timestamped-entity.model';

export interface FormAnswer {
  question: string;
  answer: string;
}

export interface StatusChange {
  from: ApplicationStatus;
  to: ApplicationStatus;
  at: Date;
  note?: string;
}

/** One job the user is pursuing. Owns the review → approve → apply lifecycle. */
@model({
  settings: {
    strict: true,
    hiddenProperties: ['approvedPdfKey', 'screenshotKey'],
    mongodb: { collection: 'job_applications' },
    indexes: {
      uniqueListing: { keys: { userId: 1, jobListingId: 1 }, options: { unique: true } },
      byStatus: { keys: { userId: 1, status: 1, updatedAt: -1 } },
    },
  },
})
export class JobApplication extends OwnedEntity {
  @property({ type: 'string', required: true, mongodb: { dataType: 'ObjectId' } })
  jobListingId: string;

  @property({ type: 'string', required: true, jsonSchema: { enum: Object.values(ApplicationStatus) } })
  status: ApplicationStatus;

  /** The variant under review, or the approved one once APPROVED. */
  @property({ type: 'string' })
  variantId?: string;

  /** Frozen at approval: the exact PDF that may be submitted or attached. */
  @property({ type: 'string' })
  approvedPdfKey?: string;

  @property.array(Object, { default: [] })
  approvedFormAnswers: FormAnswer[];

  @property({ type: 'string' })
  approvedCoverNote?: string;

  /** True when the system started tailoring because of a high match score. */
  @property({ type: 'boolean', default: false })
  autoTailored: boolean;

  @property({ type: 'string' })
  method?: string;

  @property({ type: 'string' })
  screenshotKey?: string;

  @property({ type: 'string' })
  lastError?: string;

  @property.array(Object, { default: [] })
  history: StatusChange[];

  @property({ type: 'date' })
  approvedAt?: Date;

  @property({ type: 'date' })
  appliedAt?: Date;

  constructor(data?: Partial<JobApplication>) {
    super(data);
  }
}

export enum VariantStatus {
  DRAFT = 'DRAFT',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  SUPERSEDED = 'SUPERSEDED',
}

/** A resume rewritten for one job. Never edits the master; always compared against it. */
@model({
  settings: {
    strict: true,
    hiddenProperties: ['pdfKey'],
    mongodb: { collection: 'resume_variants' },
    indexes: { byApplication: { keys: { userId: 1, applicationId: 1, generation: -1 } } },
  },
})
export class ResumeVariant extends OwnedEntity {
  @property({ type: 'string', required: true, mongodb: { dataType: 'ObjectId' } })
  applicationId: string;

  @property({ type: 'string', required: true, mongodb: { dataType: 'ObjectId' } })
  jobListingId: string;

  @property({ type: 'string', required: true, mongodb: { dataType: 'ObjectId' } })
  baseResumeId: string;

  @property({ type: 'number', required: true })
  generation: number;

  @property({ type: 'string', required: true, jsonSchema: { enum: Object.values(VariantStatus) } })
  status: VariantStatus;

  @property({ type: 'object', required: true })
  document: ResumeDocument;

  @property({ type: 'string', required: true })
  templateId: string;

  @property({ type: 'string' })
  pdfKey?: string;

  @property({ type: 'string', default: '' })
  coverNote: string;

  @property.array(Object, { default: [] })
  formAnswers: FormAnswer[];

  @property.array(Object, { default: [] })
  changes: ResumeChange[];

  @property({ type: 'object', required: true })
  keywordCoverage: KeywordCoverage;

  @property({ type: 'object', required: true })
  factCheck: FactCheckResult;

  @property({ type: 'string' })
  instructions?: string;

  @property({ type: 'boolean', default: false })
  userEdited: boolean;

  @property({ type: 'object' })
  generatedBy?: { provider: string; model: string };

  constructor(data?: Partial<ResumeVariant>) {
    super(data);
  }
}

/** Keywords extracted from a job description, shared across users by job fingerprint. */
@model({
  settings: {
    strict: true,
    mongodb: { collection: 'jd_keyword_cache' },
    indexes: { uniqueFingerprint: { keys: { fingerprint: 1 }, options: { unique: true } } },
  },
})
export class JdKeywordCache extends TimestampedEntity {
  @property({ type: 'string', required: true })
  fingerprint: string;

  @property.array(String, { default: [] })
  mustHave: string[];

  @property.array(String, { default: [] })
  niceToHave: string[];

  @property({ type: 'string' })
  seniority?: string;

  constructor(data?: Partial<JdKeywordCache>) {
    super(data);
  }
}
