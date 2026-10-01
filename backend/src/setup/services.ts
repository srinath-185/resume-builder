import { Application, Constructor, createBindingFromClass } from '@loopback/core';
import { QueueService } from '../queue/queue.service';
import { AuditService } from '../services/audit/audit.service';
import { AuthService } from '../services/auth/auth.service';
import { JwtService } from '../services/auth/jwt.service';
import { EncryptionService } from '../services/common/encryption.service';
import { LoggerService } from '../services/common/logger.service';
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
import { JobMatchService } from '../services/jobs/job-match.service';
import { JobSourceService } from '../services/jobs/job-source.service';

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
  // Auth
  JwtService,
  AuthService,
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
];

export function registerServices(app: Application, classes: Constructor<unknown>[] = SERVICE_CLASSES): void {
  for (const serviceClass of classes) {
    app.add(createBindingFromClass(serviceClass, { key: `services.${serviceClass.name}` }));
  }
}
