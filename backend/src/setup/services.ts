import { Application, Constructor, createBindingFromClass } from '@loopback/core';
import { QueueService } from '../queue/queue.service';
import { AuditService } from '../services/audit/audit.service';
import { EncryptionService } from '../services/common/encryption.service';
import { LoggerService } from '../services/common/logger.service';

/**
 * Single registration point for services. Each class is bound as
 * `services.<ClassName>` with the scope declared by its @injectable decorator.
 * Feature branches append to SERVICE_CLASSES.
 */
export const SERVICE_CLASSES: Constructor<unknown>[] = [LoggerService, EncryptionService, AuditService, QueueService];

export function registerServices(app: Application, classes: Constructor<unknown>[] = SERVICE_CLASSES): void {
  for (const serviceClass of classes) {
    app.add(createBindingFromClass(serviceClass, { key: `services.${serviceClass.name}` }));
  }
}
