import { BindingScope, inject, injectable } from '@loopback/core';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { envInt, envList } from '../../common/config/env.util';
import { AppBusinessError, ERROR_CODES } from '../../common/errors';
import { applicantFrom, chooseStrategy } from '../../domain/apply-fields';
import { ApplicationStatus } from '../../domain/application-status';
import { JobApplication } from '../../models';
import { QueueService } from '../../queue/queue.service';
import { JobApplicationRepository, ResumeVariantRepository } from '../../repositories';
import { AuditService } from '../audit/audit.service';
import { LoggerService } from '../common/logger.service';
import { StorageService } from '../common/storage.service';
import { CandidateProfileService } from '../resume/candidate-profile.service';
import { ApplicationLifecycleService } from '../tailoring/application-lifecycle.service';
import { ApplicationService } from '../tailoring/application.service';
import { ApplyResult, runAtsForm, runLinkedInEasyApply } from './apply-strategies';
import { BrowserService } from './browser.service';
import { screenshot } from './form-filler';
import { PortalSessionService } from './portal-session.service';

export const AUTO_APPLY_QUEUE = 'auto-apply';

export interface AutoApplyJob {
  userId: string;
  applicationId: string;
}

function startOfUtcDay(now = new Date()): Date {
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

/**
 * Submits an approved application in a headless browser. It can only start
 * from an approved state (the transition table) and only uses the frozen
 * approved PDF, cover note and answers (`approvedMaterials`). Whatever it
 * cannot complete with certainty ends in NEEDS_REVIEW with a screenshot.
 */
@injectable({ scope: BindingScope.TRANSIENT })
export class ApplyAgentService {
  constructor(
    @inject('repositories.JobApplicationRepository') private applications: JobApplicationRepository,
    @inject('repositories.ResumeVariantRepository') private variants: ResumeVariantRepository,
    @inject('services.ApplicationService') private applicationService: ApplicationService,
    @inject('services.ApplicationLifecycleService') private lifecycle: ApplicationLifecycleService,
    @inject('services.CandidateProfileService') private profiles: CandidateProfileService,
    @inject('services.PortalSessionService') private sessions: PortalSessionService,
    @inject('services.BrowserService') private browser: BrowserService,
    @inject('services.StorageService') private storage: StorageService,
    @inject('services.QueueService') private queue: QueueService,
    @inject('services.AuditService') private audit: AuditService,
    @inject('services.LoggerService') private logger: LoggerService,
  ) {}

  async requestApply(userId: string, applicationId: string): Promise<JobApplication> {
    const { application } = await this.applicationService.approvedMaterials(userId, applicationId);
    const cap = (await this.profiles.get(userId)).dailyCaps.apply;
    const used =
      (await this.applications.countOwned(userId, { status: ApplicationStatus.APPLIED, appliedAt: { gte: startOfUtcDay() } })).count +
      (await this.applications.countOwned(userId, { status: ApplicationStatus.APPLYING })).count;
    if (used >= cap) throw new AppBusinessError(ERROR_CODES.APPLY_DAILY_CAP_REACHED, `Daily limit of ${cap} applications reached; it resets at 00:00 UTC`);

    const applying = await this.lifecycle.transition(application, ApplicationStatus.APPLYING, { data: { lastError: undefined } });
    await this.queue.enqueue<AutoApplyJob>(AUTO_APPLY_QUEUE, { userId, applicationId }, { jobId: `apply-${applicationId}-${Date.now()}` });
    return applying;
  }

  /** Called after the user approves; starts applying only if they opted in. */
  async applyIfAutoEnabled(userId: string, applicationId: string): Promise<void> {
    if (!(await this.profiles.get(userId)).autoApplyOnApprove) return;
    try {
      await this.requestApply(userId, applicationId);
    } catch (error) {
      this.logger.info('Auto-apply after approval skipped', { applicationId, error: (error as Error).message });
    }
  }

  async run({ userId, applicationId }: AutoApplyJob): Promise<void> {
    const application = await this.applications.findOwnedById(userId, applicationId);
    if (application.status !== ApplicationStatus.APPLYING) return;

    const materials = await this.applicationService.approvedMaterials(userId, applicationId);
    const url = materials.listing.applyUrl ?? materials.listing.url;
    const strategy = chooseStrategy(url, envList('APPLY_FORM_HOSTS'));
    if (strategy === 'manual') {
      await this.finish(application, { outcome: 'NEEDS_REVIEW', reason: 'This site is not automated; open the job link and apply with the approved PDF' }, 'MANUAL');
      return;
    }
    if (!this.browser.isAvailable()) {
      await this.finish(application, { outcome: 'NEEDS_REVIEW', reason: 'No browser is installed on the server; apply manually' }, strategy);
      return;
    }

    const variant = await this.variants.findOwnedById(userId, application.variantId!);
    const data = applicantFrom(variant.document, materials.coverNote, materials.formAnswers);
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rb-apply-'));
    const resumePath = path.join(workDir, materials.fileName);
    await fs.writeFile(resumePath, materials.pdf);

    let result: ApplyResult;
    let shot: Buffer | undefined;
    try {
      const cookies = strategy === 'linkedin-easy-apply' ? await this.sessions.cookiesFor(userId, 'linkedin') : undefined;
      result = await this.browser.withPage(async page => {
        const timeout = new Promise<ApplyResult>(resolve =>
          setTimeout(() => resolve({ outcome: 'NEEDS_REVIEW', reason: 'Applying took too long; check the screenshot' }), envInt('APPLY_TIMEOUT_MS', 180_000)),
        );
        const attempt = strategy === 'ats-form' ? runAtsForm(page, { url, data, resumePath }) : runLinkedInEasyApply(page, { url, data, resumePath, cookies });
        const outcome = await Promise.race([attempt, timeout]);
        shot = await screenshot(page);
        return outcome;
      });
      if (result.sessionExpired) await this.sessions.markExpired(userId, 'linkedin');
    } catch (error) {
      this.logger.warn('Assisted apply failed', { applicationId, error: (error as Error).message });
      await this.finish(application, { outcome: 'NEEDS_REVIEW', reason: `The browser failed: ${(error as Error).message}`.slice(0, 300) }, strategy, shot, true);
      return;
    } finally {
      await fs.rm(workDir, { recursive: true, force: true });
    }
    await this.finish(application, result, strategy, shot);
  }

  async screenshotOf(userId: string, applicationId: string): Promise<Buffer> {
    const application = await this.applicationService.get(userId, applicationId);
    if (!application.screenshotKey) throw new AppBusinessError(ERROR_CODES.FILE_NOT_FOUND, 'No screenshot for this application');
    return this.storage.get(application.screenshotKey);
  }

  private async finish(application: JobApplication, result: ApplyResult, method: string, shot?: Buffer, failed = false): Promise<void> {
    let screenshotKey: string | undefined;
    if (shot) {
      screenshotKey = `${application.userId}/screenshots/${randomUUID()}.png`;
      await this.storage.put(screenshotKey, shot);
      if (application.screenshotKey) await this.storage.delete(application.screenshotKey);
    }
    const current = await this.applications.findById(application.id!);
    const to = failed ? ApplicationStatus.FAILED : result.outcome === 'APPLIED' ? ApplicationStatus.APPLIED : ApplicationStatus.NEEDS_REVIEW;
    const note = [result.reason, ...(result.details ?? []).map(detail => `• ${detail}`)].filter(Boolean).join('\n');
    await this.lifecycle.transition(current, to, {
      actor: 'system',
      note: note || undefined,
      data: {
        method,
        lastError: to === ApplicationStatus.APPLIED ? undefined : note.slice(0, 1000),
        ...(screenshotKey ? { screenshotKey } : {}),
        ...(to === ApplicationStatus.APPLIED ? { appliedAt: new Date() } : {}),
      },
    });
    await this.audit.record({ userId: application.userId, action: to === ApplicationStatus.APPLIED ? 'APPLICATION_SUBMITTED' : 'APPLICATION_NEEDS_REVIEW', entity: 'JobApplication', entityId: application.id, meta: { method, reason: result.reason } });
  }
}
