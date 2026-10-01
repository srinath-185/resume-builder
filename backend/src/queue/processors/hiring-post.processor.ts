import { inject } from '@loopback/core';
import { HiringPostJob, HiringPostService, HIRING_POST_QUEUE } from '../../services/outreach/hiring-post.service';
import { QueueProcessor } from '../queue.types';

export class HiringPostProcessor implements QueueProcessor<HiringPostJob> {
  readonly queueName = HIRING_POST_QUEUE;
  readonly concurrency = 1;
  readonly attempts = 1;

  constructor(@inject('services.HiringPostService') private posts: HiringPostService) {}

  async handle(job: HiringPostJob): Promise<void> {
    await this.posts.search(job);
  }
}
