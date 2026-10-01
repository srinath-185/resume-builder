import { inject } from '@loopback/core';
import { ApplyAgentService, AutoApplyJob, AUTO_APPLY_QUEUE } from '../../services/apply/apply-agent.service';
import { QueueProcessor } from '../queue.types';

export class AutoApplyProcessor implements QueueProcessor<AutoApplyJob> {
  readonly queueName = AUTO_APPLY_QUEUE;
  readonly concurrency = 1;
  // Never retried automatically: a retry after a partial submit could apply twice.
  readonly attempts = 1;

  constructor(@inject('services.ApplyAgentService') private agent: ApplyAgentService) {}

  handle(job: AutoApplyJob): Promise<void> {
    return this.agent.run(job);
  }
}
