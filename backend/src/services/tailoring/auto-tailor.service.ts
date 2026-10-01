import { BindingScope, inject, injectable } from '@loopback/core';
import { AppError, ERROR_CODES } from '../../common/errors';
import { ApplicationStatus } from '../../domain/application-status';
import { JobListing } from '../../models';
import { LoggerService } from '../common/logger.service';
import { HighMatchHandler } from '../jobs/job-match.service';
import { ApplicationService } from './application.service';

/**
 * Drafts a tailored resume for every job scoring at or above the user's
 * threshold, until the daily tailoring cap is reached. Drafting is all it
 * does: the result still waits for the user's review and approval.
 */
@injectable({ scope: BindingScope.TRANSIENT })
export class AutoTailorService implements HighMatchHandler {
  constructor(
    @inject('services.ApplicationService') private applications: ApplicationService,
    @inject('services.LoggerService') private logger: LoggerService,
  ) {}

  async onHighMatch(userId: string, listings: JobListing[]): Promise<void> {
    const best = [...listings].sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
    for (const listing of best) {
      const existing = await this.applications.ensureForListing(userId, listing.id!, true);
      if (existing.status !== ApplicationStatus.MATCHED) continue; // already in progress or decided
      try {
        await this.applications.requestTailor(userId, listing.id!, { auto: true });
      } catch (error) {
        if (error instanceof AppError && error.code === ERROR_CODES.TAILOR_DAILY_CAP_REACHED) {
          this.logger.info('Auto-tailor stopped at daily cap', { userId });
          return;
        }
        this.logger.warn('Auto-tailor skipped a job', { userId, listingId: listing.id, error: (error as Error).message });
      }
    }
  }
}
