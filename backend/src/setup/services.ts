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
];

export function registerServices(app: Application, classes: Constructor<unknown>[] = SERVICE_CLASSES): void {
  for (const serviceClass of classes) {
    app.add(createBindingFromClass(serviceClass, { key: `services.${serviceClass.name}` }));
  }
}
