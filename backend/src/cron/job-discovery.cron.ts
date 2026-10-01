import { inject } from '@loopback/core';
import { CronJob, cronJob } from '@loopback/cron';
import { envString } from '../common/config/env.util';
import { LoggerService } from '../services/common/logger.service';
import { JobDiscoveryService } from '../services/jobs/job-discovery.service';

/** Hourly by default; each user is actually searched every JOB_DISCOVERY_INTERVAL_HOURS. */
@cronJob()
export class JobDiscoveryCron extends CronJob {
  constructor(
    @inject('services.JobDiscoveryService') discovery: JobDiscoveryService,
    @inject('services.LoggerService') logger: LoggerService,
  ) {
    super({
      name: 'job-discovery',
      cronTime: envString('JOB_DISCOVERY_CRON', '0 * * * *')!,
      timeZone: 'UTC',
      start: true,
      onTick: async () => {
        try {
          const queued = await discovery.enqueueDueUsers();
          logger.info('Job discovery tick', { queued: queued.length });
        } catch (error) {
          logger.error('Job discovery tick failed', error);
        }
      },
    });
  }
}
