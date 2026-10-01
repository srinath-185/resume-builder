import { model, property } from '@loopback/repository';
import { ResumeDocument } from '../../domain/resume-document';
import { OwnedEntity } from '../base/timestamped-entity.model';

export enum ResumeParseStatus {
  PENDING = 'PENDING',
  PARSING = 'PARSING',
  PARSED = 'PARSED',
  FAILED = 'FAILED',
}

/** A master resume the user uploaded. Tailored variants are separate records that point back here. */
@model({
  settings: {
    strict: true,
    hiddenProperties: ['extractedText', 'fileKey'],
    mongodb: { collection: 'resumes' },
    indexes: { userCreated: { keys: { userId: 1, createdAt: -1 } } },
  },
})
export class Resume extends OwnedEntity {
  @property({ type: 'string', required: true })
  fileName: string;

  @property({ type: 'string', required: true })
  fileKey: string;

  @property({ type: 'string', required: true })
  mimeType: string;

  @property({ type: 'number', required: true })
  size: number;

  @property({ type: 'boolean', default: false })
  isPrimary: boolean;

  @property({ type: 'string', required: true, jsonSchema: { enum: Object.values(ResumeParseStatus) } })
  parseStatus: ResumeParseStatus;

  @property({ type: 'string' })
  parseError?: string;

  /** Exact text extracted from the upload — the source of truth the fact-checker compares against. */
  @property({ type: 'string' })
  extractedText?: string;

  @property({ type: 'object' })
  document?: ResumeDocument;

  /** True once the user has saved corrections; reparsing then asks before overwriting. */
  @property({ type: 'boolean', default: false })
  userEdited: boolean;

  @property({ type: 'object' })
  parsedBy?: { provider: string; model: string };

  @property({ type: 'date' })
  parsedAt?: Date;

  constructor(data?: Partial<Resume>) {
    super(data);
  }
}
