import { BindingScope, inject, injectable } from '@loopback/core';
import { DataObject } from '@loopback/repository';
import { randomUUID } from 'crypto';
import { AppBusinessError, AppValidationError, ERROR_CODES } from '../../common/errors';
import { ApplicationStatus, HAS_APPROVED_VARIANT } from '../../domain/application-status';
import { ResumeDocumentSchema, resumeToText } from '../../domain/resume-document';
import { FormAnswer, JobApplication, JobListing, JobListingStatus, ResumeVariant, VariantStatus } from '../../models';
import { QueueService } from '../../queue/queue.service';
import { JobApplicationRepository, JobListingRepository, ResumeRepository, ResumeVariantRepository } from '../../repositories';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../common/storage.service';
import { ResumeRenderService } from '../render/resume-render.service';
import { CandidateProfileService } from '../resume/candidate-profile.service';
import { ResumeService } from '../resume/resume.service';
import { ApplicationLifecycleService } from './application-lifecycle.service';
import { JdKeywordService } from './jd-keyword.service';
import { ResumeTailorJob, RESUME_TAILOR_QUEUE } from './resume-tailor.service';
import { evaluateVariant } from './variant-evaluation';

export interface VariantEdit {
  document?: unknown;
  coverNote?: string;
  formAnswers?: FormAnswer[];
}

export interface ApplicationReview {
  application: JobApplication;
  listing: JobListing;
  variant?: ResumeVariant;
  master?: { resumeId: string; document: unknown };
}

export type ApplicationSummary = DataObject<JobApplication> & { jobTitle?: string; company?: string; location?: string };

export interface ApprovedMaterials {
  application: JobApplication;
  listing: JobListing;
  pdf: Buffer;
  fileName: string;
  formAnswers: FormAnswer[];
  coverNote?: string;
}

function startOfUtcDay(now = new Date()): Date {
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

/**
 * The review → approve flow. Approval is only possible from REVIEW_PENDING,
 * on the current DRAFT variant, with a passing fact-check; it freezes the PDF,
 * cover note and answers that apply/outreach are later allowed to use
 * (`approvedMaterials`).
 */
@injectable({ scope: BindingScope.TRANSIENT })
export class ApplicationService {
  constructor(
    @inject('repositories.JobApplicationRepository') private applications: JobApplicationRepository,
    @inject('repositories.ResumeVariantRepository') private variants: ResumeVariantRepository,
    @inject('repositories.JobListingRepository') private listings: JobListingRepository,
    @inject('repositories.ResumeRepository') private resumeRepo: ResumeRepository,
    @inject('services.ResumeService') private resumes: ResumeService,
    @inject('services.CandidateProfileService') private profiles: CandidateProfileService,
    @inject('services.JdKeywordService') private keywords: JdKeywordService,
    @inject('services.ResumeRenderService') private renderer: ResumeRenderService,
    @inject('services.StorageService') private storage: StorageService,
    @inject('services.ApplicationLifecycleService') private lifecycle: ApplicationLifecycleService,
    @inject('services.QueueService') private queue: QueueService,
    @inject('services.AuditService') private audit: AuditService,
  ) {}

  /** Applications with the job's title, company and location, so lists never show bare ids. */
  async list(userId: string, status?: ApplicationStatus): Promise<ApplicationSummary[]> {
    const where = status && Object.values(ApplicationStatus).includes(status) ? { status } : undefined;
    const applications = await this.applications.findOwned(userId, { where, order: ['updatedAt DESC'], limit: 200 });
    const listingIds = [...new Set(applications.map(application => application.jobListingId))];
    const listings = listingIds.length
      ? await this.listings.findOwned(userId, { where: { id: { inq: listingIds } }, fields: { id: true, title: true, company: true, location: true } })
      : [];
    const byId = new Map(listings.map(listing => [listing.id, listing]));
    return applications.map(application => {
      const listing = byId.get(application.jobListingId);
      return { ...(application.toJSON() as DataObject<JobApplication>), jobTitle: listing?.title, company: listing?.company, location: listing?.location };
    });
  }

  get(userId: string, id: string): Promise<JobApplication> {
    return this.applications.findOwnedById(userId, id, {}, ERROR_CODES.APPLICATION_NOT_FOUND);
  }

  async review(userId: string, id: string): Promise<ApplicationReview> {
    const application = await this.get(userId, id);
    const listing = await this.listings.findOwnedById(userId, application.jobListingId, {}, ERROR_CODES.JOB_NOT_FOUND);
    const variant = application.variantId ? await this.variants.findOwnedById(userId, application.variantId) : undefined;
    const masterResume = variant ? await this.resumeRepo.findOwnedById(userId, variant.baseResumeId).catch(() => undefined) : undefined;
    return {
      application,
      listing,
      variant,
      master: masterResume?.document ? { resumeId: masterResume.id!, document: masterResume.document } : undefined,
    };
  }

  /** Starts (or restarts) tailoring for a listing. `auto` marks system-initiated runs. */
  async requestTailor(userId: string, listingId: string, options: { instructions?: string; auto?: boolean } = {}): Promise<JobApplication> {
    const listing = await this.listings.findOwnedById(userId, listingId, {}, ERROR_CODES.JOB_NOT_FOUND);
    await this.resumes.primaryParsed(userId); // fail fast with RESUME_NOT_PARSED
    await this.assertTailorCap(userId);

    const application = await this.ensureForListing(userId, listing.id!, options.auto ?? false);
    if (application.status === ApplicationStatus.TAILORING) {
      throw new AppBusinessError(ERROR_CODES.TAILOR_IN_PROGRESS, 'A tailored resume is already being prepared for this job');
    }
    const updated = await this.lifecycle.transition(application, ApplicationStatus.TAILORING, {
      actor: options.auto ? 'system' : 'user',
      data: { approvedPdfKey: undefined, approvedAt: undefined, approvedFormAnswers: [], approvedCoverNote: undefined, lastError: undefined },
      note: options.instructions ? 'with instructions' : undefined,
    });
    if (listing.status === JobListingStatus.NEW) await this.listings.updateById(listing.id!, { status: JobListingStatus.SHORTLISTED });
    await this.queue.enqueue<ResumeTailorJob>(RESUME_TAILOR_QUEUE, {
      userId,
      applicationId: updated.id!,
      instructions: options.instructions?.slice(0, 1000),
    });
    return updated;
  }

  async regenerate(userId: string, id: string, instructions?: string): Promise<JobApplication> {
    const application = await this.get(userId, id);
    return this.requestTailor(userId, application.jobListingId, { instructions });
  }

  async editVariant(userId: string, id: string, edit: VariantEdit): Promise<ApplicationReview> {
    const application = await this.get(userId, id);
    if (application.status !== ApplicationStatus.REVIEW_PENDING || !application.variantId) {
      throw new AppBusinessError(ERROR_CODES.INVALID_STATUS_TRANSITION, 'Only a resume awaiting review can be edited');
    }
    const variant = await this.variants.findOwnedById(userId, application.variantId);
    const update: Partial<ResumeVariant> = { userEdited: true };
    if (edit.coverNote !== undefined) update.coverNote = edit.coverNote;
    if (edit.formAnswers !== undefined) update.formAnswers = edit.formAnswers;

    if (edit.document !== undefined) {
      const parsed = ResumeDocumentSchema.safeParse(edit.document);
      if (!parsed.success) throw new AppValidationError(ERROR_CODES.VALIDATION_ERROR, 'Resume document is invalid', parsed.error.issues.slice(0, 20));
      const master = await this.resumeRepo.findOwnedById(userId, variant.baseResumeId);
      const listing = await this.listings.findOwnedById(userId, application.jobListingId);
      const jd = await this.keywords.forListing(listing, userId);
      const evaluation = evaluateVariant(master.document!, master.extractedText ?? resumeToText(master.document!), parsed.data, [...jd.mustHave, ...jd.niceToHave]);
      const pdfKey = `${userId}/variants/${randomUUID()}.pdf`;
      await this.storage.put(pdfKey, await this.renderer.render(parsed.data, variant.templateId));
      if (variant.pdfKey) await this.storage.delete(variant.pdfKey);
      Object.assign(update, { document: parsed.data, pdfKey, ...evaluation });
    }

    await this.variants.updateById(variant.id!, update);
    await this.audit.record({ userId, action: 'RESUME_VARIANT_EDITED', entity: 'ResumeVariant', entityId: variant.id, meta: { fields: Object.keys(edit) } });
    return this.review(userId, id);
  }

  async approve(userId: string, id: string): Promise<JobApplication> {
    const application = await this.get(userId, id);
    if (application.status !== ApplicationStatus.REVIEW_PENDING || !application.variantId) {
      throw new AppBusinessError(ERROR_CODES.INVALID_STATUS_TRANSITION, 'There is no tailored resume awaiting review');
    }
    const variant = await this.variants.findOwnedById(userId, application.variantId);
    if (variant.status !== VariantStatus.DRAFT || !variant.pdfKey) {
      throw new AppBusinessError(ERROR_CODES.VARIANT_NOT_FOUND, 'The tailored resume under review is no longer current');
    }
    if (!variant.factCheck.passed) {
      throw new AppBusinessError(
        ERROR_CODES.RESUME_TAILOR_FACT_VIOLATION,
        'Resolve the flagged statements first. Add genuinely new facts to your master resume, not to this version.',
        variant.factCheck.violations,
      );
    }

    const approved = await this.lifecycle.transition(application, ApplicationStatus.APPROVED, {
      data: {
        approvedPdfKey: variant.pdfKey,
        approvedFormAnswers: variant.formAnswers,
        approvedCoverNote: variant.coverNote,
        approvedAt: new Date(),
      },
    });
    await this.variants.updateById(variant.id!, { status: VariantStatus.APPROVED });
    await this.audit.record({ userId, action: 'RESUME_VARIANT_APPROVED', entity: 'ResumeVariant', entityId: variant.id, meta: { applicationId: id } });
    return approved;
  }

  async reject(userId: string, id: string, reason?: string): Promise<JobApplication> {
    const application = await this.get(userId, id);
    const rejected = await this.lifecycle.transition(application, ApplicationStatus.REJECTED, { note: reason });
    if (application.variantId) await this.variants.updateById(application.variantId, { status: VariantStatus.REJECTED });
    return rejected;
  }

  /** The user applied outside the app (e.g. after downloading the approved PDF). */
  async markApplied(userId: string, id: string): Promise<JobApplication> {
    const application = await this.get(userId, id);
    return this.lifecycle.transition(application, ApplicationStatus.APPLIED, { data: { appliedAt: new Date(), method: 'MANUAL' }, note: 'Marked applied by user' });
  }

  async variantPdf(userId: string, id: string): Promise<{ data: Buffer; fileName: string }> {
    const application = await this.get(userId, id);
    const key = application.approvedPdfKey ?? (application.variantId ? (await this.variants.findOwnedById(userId, application.variantId)).pdfKey : undefined);
    if (!key) throw new AppBusinessError(ERROR_CODES.VARIANT_NOT_FOUND, 'No tailored resume exists for this application yet');
    const listing = await this.listings.findOwnedById(userId, application.jobListingId);
    return { data: await this.storage.get(key), fileName: this.fileName(listing) };
  }

  /**
   * The gate for everything that leaves the system (assisted apply, recruiter
   * email): returns only what the user approved, or refuses.
   */
  async approvedMaterials(userId: string, id: string): Promise<ApprovedMaterials> {
    const application = await this.get(userId, id);
    if (!HAS_APPROVED_VARIANT.includes(application.status) || !application.approvedPdfKey) {
      throw new AppBusinessError(ERROR_CODES.RESUME_VARIANT_NOT_APPROVED, 'Approve the tailored resume for this job first');
    }
    const listing = await this.listings.findOwnedById(userId, application.jobListingId);
    return {
      application,
      listing,
      pdf: await this.storage.get(application.approvedPdfKey),
      fileName: this.fileName(listing),
      formAnswers: application.approvedFormAnswers ?? [],
      coverNote: application.approvedCoverNote,
    };
  }

  async ensureForListing(userId: string, jobListingId: string, autoTailored = false): Promise<JobApplication> {
    const existing = await this.applications.findOne({ where: { userId, jobListingId } });
    if (existing) return existing;
    return this.applications.create({ userId, jobListingId, status: ApplicationStatus.MATCHED, autoTailored, history: [], approvedFormAnswers: [] });
  }

  async tailoredToday(userId: string): Promise<number> {
    return (await this.variants.countOwned(userId, { createdAt: { gte: startOfUtcDay() } })).count;
  }

  private async assertTailorCap(userId: string): Promise<void> {
    const cap = (await this.profiles.get(userId)).dailyCaps.tailor;
    const used = (await this.tailoredToday(userId)) + (await this.applications.countOwned(userId, { status: ApplicationStatus.TAILORING })).count;
    if (used >= cap) {
      throw new AppBusinessError(ERROR_CODES.TAILOR_DAILY_CAP_REACHED, `Daily limit of ${cap} tailored resumes reached; it resets at 00:00 UTC`, { cap, used });
    }
  }

  private fileName(listing: JobListing): string {
    const slug = `${listing.company}-${listing.title}`.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
    return `resume-${slug || 'tailored'}.pdf`;
  }
}
