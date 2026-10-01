import { BindingScope, inject, injectable } from '@loopback/core';
import { Request, Response } from '@loopback/rest';
import { randomUUID } from 'crypto';
import { envInt } from '../../common/config/env.util';
import { AppBusinessError, AppValidationError, ERROR_CODES } from '../../common/errors';
import { ResumeDocument, ResumeDocumentSchema } from '../../domain/resume-document';
import { Resume, ResumeParseStatus } from '../../models';
import { QueueService } from '../../queue/queue.service';
import { ResumeRepository } from '../../repositories';
import { AuditService } from '../audit/audit.service';
import { FileUploadService } from '../common/file-upload.service';
import { StorageService } from '../common/storage.service';
import { CandidateProfileService } from './candidate-profile.service';
import { ResumeParseJob, RESUME_PARSE_QUEUE } from './resume-parse.service';
import { TextExtractionService } from './text-extraction.service';

const EXTENSION = { pdf: '.pdf', docx: '.docx', txt: '.txt' } as const;
const MAX_RESUMES_PER_USER = 20;

@injectable({ scope: BindingScope.TRANSIENT })
export class ResumeService {
  constructor(
    @inject('repositories.ResumeRepository') private resumes: ResumeRepository,
    @inject('services.FileUploadService') private uploads: FileUploadService,
    @inject('services.StorageService') private storage: StorageService,
    @inject('services.TextExtractionService') private extractor: TextExtractionService,
    @inject('services.CandidateProfileService') private profiles: CandidateProfileService,
    @inject('services.QueueService') private queue: QueueService,
    @inject('services.AuditService') private audit: AuditService,
  ) {}

  async upload(userId: string, request: Request, response: Response): Promise<Resume> {
    const count = await this.resumes.countOwned(userId);
    if (count.count >= MAX_RESUMES_PER_USER) {
      throw new AppBusinessError(ERROR_CODES.RESUME_LIMIT_REACHED, `You can keep up to ${MAX_RESUMES_PER_USER} resumes`);
    }

    const file = await this.uploads.single(request, response, {
      field: 'file',
      maxBytes: envInt('RESUME_MAX_BYTES', 5 * 1024 * 1024),
      allowed: ['pdf', 'docx', 'txt'],
    });
    // Extract before storing anything: an unreadable file is rejected outright.
    const extractedText = await this.extractor.extract(file.buffer, file.type);

    const fileKey = `${userId}/resumes/${randomUUID()}${EXTENSION[file.type]}`;
    await this.storage.put(fileKey, file.buffer);
    const resume = await this.resumes.create({
      userId,
      fileName: file.originalName,
      fileKey,
      mimeType: file.mimeType,
      size: file.size,
      isPrimary: count.count === 0,
      parseStatus: ResumeParseStatus.PENDING,
      extractedText,
      userEdited: false,
    });
    if (resume.isPrimary) await this.profiles.setPrimaryResume(userId, resume.id);

    await this.audit.record({ userId, action: 'RESUME_UPLOADED', entity: 'Resume', entityId: resume.id, after: { fileName: resume.fileName, size: resume.size } });
    await this.enqueueParse(userId, resume.id!);
    return resume;
  }

  list(userId: string): Promise<Resume[]> {
    return this.resumes.findOwned(userId, { order: ['createdAt DESC'] });
  }

  get(userId: string, id: string): Promise<Resume> {
    return this.resumes.findOwnedById(userId, id, {}, ERROR_CODES.RESUME_NOT_FOUND);
  }

  /** The user's corrections to the parsed document. Validated with the same schema the model output must pass. */
  async updateDocument(userId: string, id: string, input: unknown): Promise<Resume> {
    const resume = await this.get(userId, id);
    const parsed = ResumeDocumentSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppValidationError(ERROR_CODES.VALIDATION_ERROR, 'Resume document is invalid', parsed.error.issues.slice(0, 20));
    }
    const document: ResumeDocument = parsed.data;
    await this.resumes.updateById(id, { document, userEdited: true, parseStatus: ResumeParseStatus.PARSED });
    await this.audit.record({ userId, action: 'RESUME_EDITED', entity: 'Resume', entityId: id, before: resume.document, after: document });
    await this.profiles.seedFromResume(userId, document, id);
    return this.get(userId, id);
  }

  async setPrimary(userId: string, id: string): Promise<Resume> {
    await this.get(userId, id);
    await this.resumes.updateAll({ isPrimary: false }, { userId });
    await this.resumes.updateById(id, { isPrimary: true });
    await this.profiles.setPrimaryResume(userId, id);
    await this.audit.record({ userId, action: 'RESUME_SET_PRIMARY', entity: 'Resume', entityId: id });
    return this.get(userId, id);
  }

  async reparse(userId: string, id: string, force: boolean): Promise<Resume> {
    const resume = await this.get(userId, id);
    if (resume.parseStatus === ResumeParseStatus.PARSING) {
      throw new AppBusinessError(ERROR_CODES.RESUME_PARSE_IN_PROGRESS, 'This resume is already being parsed');
    }
    if (resume.userEdited && !force) {
      throw new AppBusinessError(ERROR_CODES.RESUME_HAS_EDITS, 'Reparsing replaces your corrections; confirm to continue');
    }
    await this.resumes.updateById(id, { parseStatus: ResumeParseStatus.PENDING, parseError: undefined });
    await this.enqueueParse(userId, id);
    return this.get(userId, id);
  }

  async delete(userId: string, id: string): Promise<void> {
    const resume = await this.get(userId, id);
    await this.resumes.deleteById(id);
    await this.storage.delete(resume.fileKey);
    if (resume.isPrimary) {
      const [next] = await this.resumes.findOwned(userId, { order: ['createdAt DESC'], limit: 1 });
      if (next) await this.resumes.updateById(next.id!, { isPrimary: true });
      await this.profiles.setPrimaryResume(userId, next?.id);
    }
    await this.audit.record({ userId, action: 'RESUME_DELETED', entity: 'Resume', entityId: id, before: { fileName: resume.fileName } });
  }

  async file(userId: string, id: string): Promise<{ data: Buffer; fileName: string; mimeType: string }> {
    const resume = await this.get(userId, id);
    return { data: await this.storage.get(resume.fileKey), fileName: resume.fileName, mimeType: resume.mimeType };
  }

  /** The resume to tailor from: the primary one, or the newest parsed one. */
  async primaryParsed(userId: string): Promise<Resume> {
    const [primary] = await this.resumes.findOwned(userId, { where: { isPrimary: true, parseStatus: ResumeParseStatus.PARSED }, limit: 1 });
    if (primary) return primary;
    const [latest] = await this.resumes.findOwned(userId, { where: { parseStatus: ResumeParseStatus.PARSED }, order: ['createdAt DESC'], limit: 1 });
    if (!latest) throw new AppBusinessError(ERROR_CODES.RESUME_NOT_PARSED, 'Upload a resume and wait for it to be parsed first');
    return latest;
  }

  private enqueueParse(userId: string, resumeId: string): Promise<string> {
    return this.queue.enqueue<ResumeParseJob>(RESUME_PARSE_QUEUE, { userId, resumeId });
  }
}
