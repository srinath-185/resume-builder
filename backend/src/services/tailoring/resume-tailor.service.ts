import { BindingScope, inject, injectable } from '@loopback/core';
import { randomUUID } from 'crypto';
import { AppError, ERROR_CODES } from '../../common/errors';
import { ApplicationStatus } from '../../domain/application-status';
import { resumeToText } from '../../domain/resume-document';
import { JobApplication, VariantStatus } from '../../models';
import { JobApplicationRepository, JobListingRepository, ResumeVariantRepository } from '../../repositories';
import { AuditService } from '../audit/audit.service';
import { LoggerService } from '../common/logger.service';
import { StorageService } from '../common/storage.service';
import { LlmRouterService } from '../llm/llm-router.service';
import { LlmTask } from '../llm/llm.types';
import { ResumeRenderService } from '../render/resume-render.service';
import { CandidateProfileService } from '../resume/candidate-profile.service';
import { ResumeService } from '../resume/resume.service';
import { ApplicationLifecycleService } from './application-lifecycle.service';
import { JdKeywordService } from './jd-keyword.service';
import { TAILOR_SYSTEM, tailorUserMessage, TailorOutputSchema } from './prompts/tailor.prompts';
import { evaluateVariant } from './variant-evaluation';

export const RESUME_TAILOR_QUEUE = 'resume-tailor';

export interface ResumeTailorJob {
  userId: string;
  applicationId: string;
  instructions?: string;
}

/**
 * Produces a DRAFT variant for an application in TAILORING: extracts the
 * job's keywords, asks the model for a rewrite, fact-checks it against the
 * master resume, measures keyword coverage, renders the PDF, and moves the
 * application to REVIEW_PENDING. Any failure lands in TAILOR_FAILED with the
 * reason, never in a half-written review.
 */
@injectable({ scope: BindingScope.TRANSIENT })
export class ResumeTailorService {
  constructor(
    @inject('repositories.JobApplicationRepository') private applications: JobApplicationRepository,
    @inject('repositories.JobListingRepository') private listings: JobListingRepository,
    @inject('repositories.ResumeVariantRepository') private variants: ResumeVariantRepository,
    @inject('services.ResumeService') private resumes: ResumeService,
    @inject('services.CandidateProfileService') private profiles: CandidateProfileService,
    @inject('services.JdKeywordService') private keywords: JdKeywordService,
    @inject('services.LlmRouterService') private llm: LlmRouterService,
    @inject('services.ResumeRenderService') private renderer: ResumeRenderService,
    @inject('services.StorageService') private storage: StorageService,
    @inject('services.ApplicationLifecycleService') private lifecycle: ApplicationLifecycleService,
    @inject('services.AuditService') private audit: AuditService,
    @inject('services.LoggerService') private logger: LoggerService,
  ) {}

  async run(job: ResumeTailorJob): Promise<void> {
    const application = await this.applications.findOwnedById(job.userId, job.applicationId);
    if (application.status !== ApplicationStatus.TAILORING) return; // superseded or cancelled meanwhile

    try {
      await this.generate(application, job.instructions);
    } catch (error) {
      const message = error instanceof AppError ? `${error.code}: ${error.message}` : 'Tailoring failed unexpectedly';
      this.logger.warn('Tailoring failed', { applicationId: application.id, error: (error as Error).message });
      const current = await this.applications.findById(application.id!);
      if (current.status === ApplicationStatus.TAILORING) {
        await this.lifecycle.transition(current, ApplicationStatus.TAILOR_FAILED, { data: { lastError: message }, actor: 'system', note: message });
      }
    }
  }

  private async generate(application: JobApplication, instructions?: string): Promise<void> {
    const userId = application.userId;
    const [listing, master, profile] = await Promise.all([
      this.listings.findOwnedById(userId, application.jobListingId, {}, ERROR_CODES.JOB_NOT_FOUND),
      this.resumes.primaryParsed(userId),
      this.profiles.get(userId),
    ]);
    const masterDocument = master.document!;
    const jdKeywords = await this.keywords.forListing(listing, userId);

    const { value, completion } = await this.llm.completeJson(
      {
        task: LlmTask.RESUME_TAILOR,
        system: TAILOR_SYSTEM,
        messages: [
          {
            role: 'user',
            content: tailorUserMessage({
              job: { title: listing.title, company: listing.company, location: listing.location, description: listing.description },
              keywords: jdKeywords,
              master: masterDocument,
              instructions,
            }),
          },
        ],
        userId,
      },
      TailorOutputSchema,
    );

    const masterText = master.extractedText ?? resumeToText(masterDocument);
    const evaluation = evaluateVariant(masterDocument, masterText, value.document, [...jdKeywords.mustHave, ...jdKeywords.niceToHave], value.changes);
    const templateId = this.renderer.resolveTemplate(profile.defaultTemplateId).id;
    const pdfKey = `${userId}/variants/${randomUUID()}.pdf`;
    await this.storage.put(pdfKey, await this.renderer.render(value.document, templateId));

    const previous = await this.variants.findOwned(userId, { where: { applicationId: application.id }, order: ['generation DESC'] });
    await this.variants.updateAll({ status: VariantStatus.SUPERSEDED }, { applicationId: application.id, status: VariantStatus.DRAFT });
    const variant = await this.variants.create({
      userId,
      applicationId: application.id!,
      jobListingId: listing.id!,
      baseResumeId: master.id!,
      generation: (previous[0]?.generation ?? 0) + 1,
      status: VariantStatus.DRAFT,
      document: value.document,
      templateId,
      pdfKey,
      coverNote: value.coverNote,
      formAnswers: value.formAnswers,
      ...evaluation,
      instructions,
      userEdited: false,
      generatedBy: { provider: completion.provider, model: completion.model },
    });

    const current = await this.applications.findById(application.id!);
    await this.lifecycle.transition(current, ApplicationStatus.REVIEW_PENDING, {
      data: { variantId: variant.id, lastError: undefined },
      actor: 'system',
      note: evaluation.factCheck.passed ? undefined : `${evaluation.factCheck.violations.length} fact-check issue(s) to resolve`,
    });
    await this.audit.record({
      userId,
      action: 'RESUME_VARIANT_GENERATED',
      entity: 'ResumeVariant',
      entityId: variant.id,
      meta: {
        applicationId: application.id,
        provider: completion.provider,
        factCheckPassed: evaluation.factCheck.passed,
        coverage: `${evaluation.keywordCoverage.before}→${evaluation.keywordCoverage.after}`,
      },
    });
  }
}
