import { inject } from '@loopback/core';
import { JobDiscoveryJob, JobDiscoveryService, JobMatchJob, JOB_DISCOVERY_QUEUE, JOB_MATCH_QUEUE } from '../../services/jobs/job-discovery.service';
import { JobMatchService } from '../../services/jobs/job-match.service';
import { QueueProcessor } from '../queue.types';

export class JobDiscoveryProcessor implements QueueProcessor<JobDiscoveryJob> {
  readonly queueName = JOB_DISCOVERY_QUEUE;
  readonly concurrency = 2;
  readonly attempts = 1;

  constructor(@inject('services.JobDiscoveryService') private discovery: JobDiscoveryService) {}

  async handle(job: JobDiscoveryJob): Promise<void> {
    await this.discovery.discover(job);
  }
}

export class JobMatchProcessor implements QueueProcessor<JobMatchJob> {
  readonly queueName = JOB_MATCH_QUEUE;
  // One batch at a time keeps scoring inside the free-tier requests-per-minute cap.
  readonly concurrency = 1;
  readonly attempts = 1;

  constructor(@inject('services.JobMatchService') private matcher: JobMatchService) {}

  handle(job: JobMatchJob): Promise<void> {
    return this.matcher.scoreBatch(job);
  }
}
