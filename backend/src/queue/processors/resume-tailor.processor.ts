import { inject } from '@loopback/core';
import { ResumeTailorJob, ResumeTailorService, RESUME_TAILOR_QUEUE } from '../../services/tailoring/resume-tailor.service';
import { QueueProcessor } from '../queue.types';

export class ResumeTailorProcessor implements QueueProcessor<ResumeTailorJob> {
  readonly queueName = RESUME_TAILOR_QUEUE;
  // Tailoring uses the large model class; one at a time protects the daily token budget.
  readonly concurrency = 1;
  readonly attempts = 1;

  constructor(@inject('services.ResumeTailorService') private tailor: ResumeTailorService) {}

  handle(job: ResumeTailorJob): Promise<void> {
    return this.tailor.run(job);
  }
}
