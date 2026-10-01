import { BindingScope, inject, injectable } from '@loopback/core';
import { AppError } from '../../common/errors';
import { ResumeDocumentSchema } from '../../domain/resume-document';
import { ResumeParseStatus } from '../../models';
import { ResumeRepository } from '../../repositories';
import { AuditService } from '../audit/audit.service';
import { LoggerService } from '../common/logger.service';
import { LlmRouterService } from '../llm/llm-router.service';
import { LlmTask } from '../llm/llm.types';
import { CandidateProfileService } from './candidate-profile.service';
import { RESUME_PARSE_SYSTEM, resumeParseUserMessage } from './prompts/resume-parse.prompt';

export const RESUME_PARSE_QUEUE = 'resume-parse';

export interface ResumeParseJob {
  resumeId: string;
  userId: string;
}

/**
 * Turns the extracted text of an upload into a ResumeDocument. Runs off the
 * request path. Failures are stored on the resume (the user sees why and can
 * retry) rather than thrown, so a bad file is not retried pointlessly.
 */
@injectable({ scope: BindingScope.TRANSIENT })
export class ResumeParseService {
  constructor(
    @inject('repositories.ResumeRepository') private resumes: ResumeRepository,
    @inject('services.LlmRouterService') private llm: LlmRouterService,
    @inject('services.CandidateProfileService') private profiles: CandidateProfileService,
    @inject('services.AuditService') private audit: AuditService,
    @inject('services.LoggerService') private logger: LoggerService,
  ) {}

  async parse(job: ResumeParseJob): Promise<void> {
    const resume = await this.resumes.findOwnedById(job.userId, job.resumeId);
    if (!resume.extractedText) {
      await this.resumes.updateById(resume.id!, { parseStatus: ResumeParseStatus.FAILED, parseError: 'No extracted text to parse' });
      return;
    }
    await this.resumes.updateById(resume.id!, { parseStatus: ResumeParseStatus.PARSING, parseError: undefined });

    try {
      const { value, completion } = await this.llm.completeJson(
        {
          task: LlmTask.RESUME_PARSE,
          system: RESUME_PARSE_SYSTEM,
          messages: [{ role: 'user', content: resumeParseUserMessage(resume.extractedText) }],
          userId: job.userId,
        },
        ResumeDocumentSchema,
      );

      await this.resumes.updateById(resume.id!, {
        parseStatus: ResumeParseStatus.PARSED,
        document: value,
        parsedBy: { provider: completion.provider, model: completion.model },
        parsedAt: new Date(),
        userEdited: false,
      });
      await this.profiles.seedFromResume(job.userId, value, resume.id!);
      await this.audit.record({
        userId: job.userId,
        action: 'RESUME_PARSED',
        entity: 'Resume',
        entityId: resume.id,
        meta: { provider: completion.provider, model: completion.model, roles: value.experience.length },
      });
    } catch (error) {
      const message = error instanceof AppError ? `${error.code}: ${error.message}` : 'Parsing failed unexpectedly';
      this.logger.warn('Resume parse failed', { resumeId: resume.id, error: (error as Error).message });
      await this.resumes.updateById(resume.id!, { parseStatus: ResumeParseStatus.FAILED, parseError: message });
      await this.audit.record({ userId: job.userId, action: 'RESUME_PARSE_FAILED', entity: 'Resume', entityId: resume.id, meta: { message } });
    }
  }
}
