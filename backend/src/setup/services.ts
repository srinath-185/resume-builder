import { Application, Constructor, createBindingFromClass } from '@loopback/core';
import { QueueService } from '../queue/queue.service';
import { AdminService } from '../services/admin/admin.service';
import { AuditService } from '../services/audit/audit.service';
import { AuthService } from '../services/auth/auth.service';
import { JwtService } from '../services/auth/jwt.service';
import { EncryptionService } from '../services/common/encryption.service';
import { LoggerService } from '../services/common/logger.service';
import { RateLimitService } from '../services/common/rate-limit.service';
import { LlmBudgetService } from '../services/llm/budget/llm-budget.service';
import { LlmProviderRegistryService } from '../services/llm/llm-provider-registry.service';
import { LlmRouterService } from '../services/llm/llm-router.service';
import { LlmStatusService } from '../services/llm/llm-status.service';
import { FileUploadService } from '../services/common/file-upload.service';
import { StorageService } from '../services/common/storage.service';
import { CandidateProfileService } from '../services/resume/candidate-profile.service';
import { ResumeParseService } from '../services/resume/resume-parse.service';
import { ResumeService } from '../services/resume/resume.service';
import { TextExtractionService } from '../services/resume/text-extraction.service';
import { ResumeRenderService } from '../services/render/resume-render.service';
import { ConnectorRegistryService } from '../services/jobs/connector-registry.service';
import { JobDiscoveryService } from '../services/jobs/job-discovery.service';
import { JobListingService } from '../services/jobs/job-listing.service';
import { HIGH_MATCH_HANDLER, JobMatchService } from '../services/jobs/job-match.service';
import { JobSourceService } from '../services/jobs/job-source.service';
import { ApplicationLifecycleService } from '../services/tailoring/application-lifecycle.service';
import { ApplicationService } from '../services/tailoring/application.service';
import { AutoTailorService } from '../services/tailoring/auto-tailor.service';
import { JdKeywordService } from '../services/tailoring/jd-keyword.service';
import { ResumeTailorService } from '../services/tailoring/resume-tailor.service';
import { ContactService } from '../services/outreach/contact.service';
import { HiringPostService } from '../services/outreach/hiring-post.service';
import { PostConnectorRegistryService } from '../services/outreach/post-connector-registry.service';
import { MailConnectorService } from '../services/mail/mail-connector.service';
import { MailTransportRegistryService } from '../services/mail/mail-transport-registry.service';
import { OutreachTemplateService } from '../services/outreach/outreach-template.service';
import { OutreachService } from '../services/outreach/outreach.service';
import { ReviewReminderService } from '../services/outreach/review-reminder.service';
import { ApplyAgentService } from '../services/apply/apply-agent.service';
import { BrowserService } from '../services/apply/browser.service';
import { PortalSessionService } from '../services/apply/portal-session.service';

/**
 * Single registration point for services. Each class is bound as
 * `services.<ClassName>` with the scope declared by its @injectable decorator.
 * Feature branches append to SERVICE_CLASSES.
 */
export const SERVICE_CLASSES: Constructor<unknown>[] = [
  // Core
  LoggerService,
  EncryptionService,
  AuditService,
  QueueService,
  RateLimitService,
  // Auth and administration
  JwtService,
  AuthService,
  AdminService,
  // AI
  LlmBudgetService,
  LlmProviderRegistryService,
  LlmRouterService,
  LlmStatusService,
  // Files
  StorageService,
  FileUploadService,
  // Resumes
  TextExtractionService,
  CandidateProfileService,
  ResumeParseService,
  ResumeService,
  ResumeRenderService,
  // Jobs
  ConnectorRegistryService,
  JobSourceService,
  JobDiscoveryService,
  JobMatchService,
  JobListingService,
  // Tailoring and review
  JdKeywordService,
  ApplicationLifecycleService,
  ApplicationService,
  ResumeTailorService,
  AutoTailorService,
  // Hiring posts and contacts
  PostConnectorRegistryService,
  ContactService,
  HiringPostService,
  // Mail and outreach
  MailTransportRegistryService,
  MailConnectorService,
  OutreachTemplateService,
  OutreachService,
  ReviewReminderService,
  // Assisted apply
  BrowserService,
  PortalSessionService,
  ApplyAgentService,
];

export function registerServices(app: Application, classes: Constructor<unknown>[] = SERVICE_CLASSES): void {
  for (const serviceClass of classes) {
    app.add(createBindingFromClass(serviceClass, { key: `services.${serviceClass.name}` }));
  }
  // High-scoring matches are drafted automatically (still subject to review).
  app.bind(HIGH_MATCH_HANDLER).toAlias('services.AutoTailorService');
}
