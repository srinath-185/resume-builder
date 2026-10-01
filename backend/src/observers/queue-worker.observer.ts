import { Context, inject, lifeCycleObserver, LifeCycleObserver } from '@loopback/core';
import { CoreBindings } from '@loopback/core';
import { envBool } from '../common/config/env.util';
import { QueueService } from '../queue/queue.service';
import { QUEUE_PROCESSOR_TAG, QueueProcessor } from '../queue/queue.types';

/**
 * Registers every `queue.processor`-tagged binding with the QueueService, then
 * starts BullMQ workers when this process owns them (RUN_WORKERS). Inline jobs
 * always run in-process, so registration happens regardless of RUN_WORKERS.
 */
@lifeCycleObserver('queue')
export class QueueWorkerObserver implements LifeCycleObserver {
  constructor(
    @inject(CoreBindings.APPLICATION_INSTANCE) private app: Context,
    @inject('services.QueueService') private queueService: QueueService,
  ) {}

  async init(): Promise<void> {
    const bindings = this.app.findByTag(QUEUE_PROCESSOR_TAG);
    for (const binding of bindings) {
      const processor = await this.app.get<QueueProcessor>(binding.key);
      this.queueService.register(processor);
    }
  }

  start(): void {
    if (envBool('RUN_WORKERS', true)) this.queueService.startWorkers();
  }

  async stop(): Promise<void> {
    await this.queueService.stop();
  }
}
