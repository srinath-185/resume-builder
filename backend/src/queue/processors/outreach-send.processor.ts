import { inject } from '@loopback/core';
import { OutreachSendJob, OutreachService, OUTREACH_SEND_QUEUE } from '../../services/outreach/outreach.service';
import { QueueProcessor } from '../queue.types';

export class OutreachSendProcessor implements QueueProcessor<OutreachSendJob> {
  readonly queueName = OUTREACH_SEND_QUEUE;
  readonly concurrency = 1;
  // deliver() records failures on the message; retrying a half-delivered email risks a duplicate.
  readonly attempts = 1;

  constructor(@inject('services.OutreachService') private outreach: OutreachService) {}

  handle(job: OutreachSendJob): Promise<void> {
    return this.outreach.deliver(job);
  }
}
