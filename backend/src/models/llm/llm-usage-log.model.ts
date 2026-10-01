import { model, property } from '@loopback/repository';
import { TimestampedEntity } from '../base/timestamped-entity.model';

/** One row per provider call, successful or not. Feeds the usage page and cost reviews. */
@model({
  settings: {
    strict: true,
    mongodb: { collection: 'llm_usage_logs' },
    indexes: {
      userDay: { keys: { userId: 1, createdAt: -1 } },
      providerDay: { keys: { provider: 1, createdAt: -1 } },
    },
  },
})
export class LlmUsageLog extends TimestampedEntity {
  @property({ type: 'string' })
  userId?: string;

  @property({ type: 'string', required: true })
  task: string;

  @property({ type: 'string', required: true })
  provider: string;

  @property({ type: 'string', required: true })
  model: string;

  @property({ type: 'number', default: 0 })
  inputTokens: number;

  @property({ type: 'number', default: 0 })
  outputTokens: number;

  @property({ type: 'number', default: 0 })
  latencyMs: number;

  @property({ type: 'boolean', required: true })
  success: boolean;

  @property({ type: 'string' })
  error?: string;

  constructor(data?: Partial<LlmUsageLog>) {
    super(data);
  }
}
