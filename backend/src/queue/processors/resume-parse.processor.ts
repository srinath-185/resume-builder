import { inject } from '@loopback/core';
import { ResumeParseJob, ResumeParseService, RESUME_PARSE_QUEUE } from '../../services/resume/resume-parse.service';
import { QueueProcessor } from '../queue.types';

export class ResumeParseProcessor implements QueueProcessor<ResumeParseJob> {
  readonly queueName = RESUME_PARSE_QUEUE;
  // One at a time: parsing uses the large model class, the tightest free-tier budget.
  readonly concurrency = 1;
  readonly attempts = 1;

  constructor(@inject('services.ResumeParseService') private parser: ResumeParseService) {}

  handle(job: ResumeParseJob): Promise<void> {
    return this.parser.parse(job);
  }
}
