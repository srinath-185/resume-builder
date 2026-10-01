export interface JobMeta {
  jobId: string;
  /** 1-based attempt number. */
  attempt: number;
}

/**
 * A background job handler. Implementations are bound with the
 * `queue.processor` tag and picked up by QueueWorkerObserver at start.
 */
export interface QueueProcessor<T = unknown> {
  readonly queueName: string;
  /** Concurrent jobs per process. LLM queues stay at 1–2 to respect provider RPM caps. */
  readonly concurrency?: number;
  readonly attempts?: number;
  handle(data: T, meta: JobMeta): Promise<void>;
}

export const QUEUE_PROCESSOR_TAG = 'queue.processor';

export interface EnqueueOptions {
  /** Same jobId twice is a no-op on BullMQ, which makes enqueueing idempotent. */
  jobId?: string;
  delayMs?: number;
}
