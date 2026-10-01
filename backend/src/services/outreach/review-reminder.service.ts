import { BindingScope, inject, injectable } from '@loopback/core';
import { envInt } from '../../common/config/env.util';
import { ApplicationStatus } from '../../domain/application-status';
import { MailConnectorStatus } from '../../models';
import { CandidateProfileRepository, JobApplicationRepository, MailConnectorRepository, UserRepository } from '../../repositories';
import { LoggerService } from '../common/logger.service';
import { MailConnectorService } from '../mail/mail-connector.service';

/**
 * Nudges users whose tailored resumes have waited in review for more than
 * REVIEW_REMINDER_DAYS, at most once a day, through their own connected
 * mailbox (to themselves). Users without a mailbox are skipped.
 */
@injectable({ scope: BindingScope.TRANSIENT })
export class ReviewReminderService {
  constructor(
    @inject('repositories.JobApplicationRepository') private applications: JobApplicationRepository,
    @inject('repositories.CandidateProfileRepository') private profiles: CandidateProfileRepository,
    @inject('repositories.MailConnectorRepository') private connectors: MailConnectorRepository,
    @inject('repositories.UserRepository') private users: UserRepository,
    @inject('services.MailConnectorService') private mail: MailConnectorService,
    @inject('services.LoggerService') private logger: LoggerService,
  ) {}

  async sendDue(now = new Date()): Promise<string[]> {
    const staleBefore = new Date(now.getTime() - envInt('REVIEW_REMINDER_DAYS', 2) * 86_400_000);
    const waiting = await this.applications.find({ where: { status: ApplicationStatus.REVIEW_PENDING, updatedAt: { lte: staleBefore } }, fields: { userId: true }, limit: 5000 });
    const counts = new Map<string, number>();
    for (const application of waiting) counts.set(application.userId, (counts.get(application.userId) ?? 0) + 1);

    const reminded: string[] = [];
    for (const [userId, count] of counts) {
      const profile = await this.profiles.findForUser(userId);
      if (profile?.lastReviewReminderAt && now.getTime() - profile.lastReviewReminderAt.getTime() < 20 * 3_600_000) continue;
      const connector = await this.connectors.findOne({ where: { userId, status: MailConnectorStatus.CONNECTED } });
      if (!connector) continue;
      const user = await this.users.findById(userId);
      try {
        await this.mail.send(userId, {
          to: user.email,
          subject: `${count} tailored resume${count === 1 ? '' : 's'} waiting for your review`,
          text: `Hi ${user.name},\n\n${count} tailored resume${count === 1 ? ' is' : 's are'} waiting for your approval. Nothing is sent or submitted until you approve.\n\nOpen Resume Builder → Applications to review them.`,
        });
        if (profile) await this.profiles.updateById(profile.id!, { lastReviewReminderAt: now });
        reminded.push(userId);
      } catch (error) {
        this.logger.warn('Review reminder failed', { userId, error: (error as Error).message });
      }
    }
    return reminded;
  }
}
