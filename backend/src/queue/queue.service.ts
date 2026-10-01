import { BindingScope, inject, injectable } from '@loopback/core';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { randomUUID } from 'crypto';
import { envString } from '../common/config/env.util';
import { AppConfigurationError } from '../common/errors';
import { LoggerService } from '../services/common/logger.service';
import { EnqueueOptions, JobMeta, QueueProcessor } from './queue.types';

export type QueueDriver = 'inline' | 'bullmq';

const DEFAULT_ATTEMPTS = 3;
const INLINE_RETRY_DELAY_MS = 50;

/**
 * One entry point for background work with two drivers:
 *
 * - `inline` (default): the job runs in this process right after enqueue. No
 *   Redis, nothing survives a restart. Good for local dev and tests, where
 *   `drain()` makes the async work deterministic.
 * - `bullmq`: jobs go to Redis, survive restarts and can be picked up by a
 *   dedicated worker process (`RUN_WORKERS`).
 *
 * Services only ever call `enqueue`, so switching drivers is configuration.
 */
@injectable({ scope: BindingScope.SINGLETON })
export class QueueService {
  private readonly processors = new Map<string, QueueProcessor>();
  private readonly inflight = new Set<Promise<void>>();
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];
  private connection?: IORedis;

  constructor(@inject('services.LoggerService') private logger: LoggerService) {}

  get driver(): QueueDriver {
    return envString('QUEUE_DRIVER', 'inline') === 'bullmq' ? 'bullmq' : 'inline';
  }

  register(processor: QueueProcessor): void {
    this.processors.set(processor.queueName, processor);
  }

  isRegistered(queueName: string): boolean {
    return this.processors.has(queueName);
  }

  async enqueue<T>(queueName: string, data: T, options: EnqueueOptions = {}): Promise<string> {
    const jobId = options.jobId ?? randomUUID();
    if (this.driver === 'bullmq') {
      const processor = this.processors.get(queueName);
      const job = await this.queue(queueName).add(queueName, data, {
        jobId,
        delay: options.delayMs,
        attempts: processor?.attempts ?? DEFAULT_ATTEMPTS,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
      return job.id ?? jobId;
    }

    const processor = this.processors.get(queueName);
    if (!processor) throw new AppConfigurationError(`No processor registered for queue ${queueName}`);
    const run = this.runInline(processor as QueueProcessor<T>, data, jobId, options.delayMs ?? 0);
    this.inflight.add(run);
    void run.finally(() => this.inflight.delete(run));
    return jobId;
  }

  /** Waits until every inline job, including jobs enqueued by jobs, has finished. */
  async drain(): Promise<void> {
    while (this.inflight.size > 0) {
      await Promise.allSettled([...this.inflight]);
    }
  }

  startWorkers(): void {
    if (this.driver !== 'bullmq') return;
    for (const processor of this.processors.values()) {
      const worker = new Worker(
        processor.queueName,
        job => processor.handle(job.data, { jobId: job.id ?? '', attempt: job.attemptsMade + 1 }),
        { connection: this.redis(), concurrency: processor.concurrency ?? 1 },
      );
      worker.on('failed', (job, error) =>
        this.logger.error('Queue job failed', error, { queue: processor.queueName, jobId: job?.id, attempt: job?.attemptsMade }),
      );
      this.workers.push(worker);
    }
    this.logger.info('Queue workers started', { queues: [...this.processors.keys()] });
  }

  async stop(): Promise<void> {
    await this.drain();
    await Promise.all(this.workers.map(worker => worker.close()));
    await Promise.all([...this.queues.values()].map(queue => queue.close()));
    this.workers.length = 0;
    this.queues.clear();
    if (this.connection) {
      await this.connection.quit();
      this.connection = undefined;
    }
  }

  private async runInline<T>(processor: QueueProcessor<T>, data: T, jobId: string, delayMs: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    const attempts = processor.attempts ?? DEFAULT_ATTEMPTS;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const meta: JobMeta = { jobId, attempt };
      try {
        await processor.handle(data, meta);
        return;
      } catch (error) {
        if (attempt === attempts) {
          this.logger.error('Inline job failed', error, { queue: processor.queueName, jobId, attempt });
          return;
        }
        await new Promise(resolve => setTimeout(resolve, INLINE_RETRY_DELAY_MS * attempt));
      }
    }
  }

  private queue(name: string): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: this.redis() });
      this.queues.set(name, queue);
    }
    return queue;
  }

  private redis(): IORedis {
    if (!this.connection) {
      const url = envString('REDIS_URL');
      if (!url) throw new AppConfigurationError('QUEUE_DRIVER=bullmq requires REDIS_URL');
      // BullMQ requires maxRetriesPerRequest: null on worker connections.
      this.connection = new IORedis(url, { maxRetriesPerRequest: null });
    }
    return this.connection;
  }
}
