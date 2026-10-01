import { Application, BindingScope, Constructor } from '@loopback/core';
import { JobDiscoveryProcessor, JobMatchProcessor } from '../queue/processors/job-discovery.processor';
import { ResumeParseProcessor } from '../queue/processors/resume-parse.processor';
import { QUEUE_PROCESSOR_TAG, QueueProcessor } from '../queue/queue.types';

/** Queue processors, one per queue. Feature branches append here. */
export const PROCESSOR_CLASSES: Constructor<QueueProcessor>[] = [ResumeParseProcessor, JobDiscoveryProcessor, JobMatchProcessor];

export function registerProcessors(app: Application, classes: Constructor<QueueProcessor>[] = PROCESSOR_CLASSES): void {
  for (const processorClass of classes) {
    app
      .bind(`processors.${processorClass.name}`)
      .toClass(processorClass)
      .inScope(BindingScope.SINGLETON)
      .tag(QUEUE_PROCESSOR_TAG);
  }
}
