import { inject } from '@loopback/core';
import { CronJob, cronJob } from '@loopback/cron';
import { envString } from '../common/config/env.util';
import { LoggerService } from '../services/common/logger.service';
import { OutreachService } from '../services/outreach/outreach.service';
import { ReviewReminderService } from '../services/outreach/review-reminder.service';

/** Drafts follow-ups that are due. They wait for the user to press Send. */
@cronJob()
export class OutreachFollowUpCron extends CronJob {
  constructor(@inject('services.OutreachService') outreach: OutreachService, @inject('services.LoggerService') logger: LoggerService) {
    super({
      name: 'outreach-follow-up',
      cronTime: envString('OUTREACH_FOLLOWUP_CRON', '0 9 * * *')!,
      timeZone: 'UTC',
      start: true,
      onTick: async () => {
        try {
          logger.info('Follow-up drafts created', { count: await outreach.createDueFollowUps() });
        } catch (error) {
          logger.error('Follow-up tick failed', error);
        }
      },
    });
  }
}

@cronJob()
export class ReviewReminderCron extends CronJob {
  constructor(@inject('services.ReviewReminderService') reminders: ReviewReminderService, @inject('services.LoggerService') logger: LoggerService) {
    super({
      name: 'review-reminder',
      cronTime: envString('REVIEW_REMINDER_CRON', '0 8 * * *')!,
      timeZone: 'UTC',
      start: true,
      onTick: async () => {
        try {
          logger.info('Review reminders sent', { count: (await reminders.sendDue()).length });
        } catch (error) {
          logger.error('Review reminder tick failed', error);
        }
      },
    });
  }
}
