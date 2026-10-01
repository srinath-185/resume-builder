import { Application, Constructor, createBindingFromClass } from '@loopback/core';
import { CronComponent, CronJob } from '@loopback/cron';
import { envBool, isTestEnv } from '../common/config/env.util';
import { JobDiscoveryCron } from '../cron/job-discovery.cron';

/** Scheduled jobs. Feature branches append here. */
export const CRON_CLASSES: Constructor<CronJob>[] = [JobDiscoveryCron];

/**
 * Crons must run in exactly one process; RUN_SCHEDULED_JOBS=false on every other
 * instance. Never registered under test.
 */
export function registerCrons(app: Application, classes: Constructor<CronJob>[] = CRON_CLASSES): boolean {
  if (isTestEnv() || !envBool('RUN_SCHEDULED_JOBS', true)) return false;
  app.component(CronComponent);
  for (const cronClass of classes) {
    app.add(createBindingFromClass(cronClass));
  }
  return true;
}
