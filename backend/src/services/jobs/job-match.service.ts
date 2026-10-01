import { BindingScope, inject, injectable } from '@loopback/core';
import { AppError } from '../../common/errors';
import { JobListing, MatchStatus } from '../../models';
import { JobListingRepository } from '../../repositories';
import { LoggerService } from '../common/logger.service';
import { LlmRouterService } from '../llm/llm-router.service';
import { LlmTask } from '../llm/llm.types';
import { CandidateProfileService } from '../resume/candidate-profile.service';
import { ResumeService } from '../resume/resume.service';
import { JobMatchJob } from './job-discovery.service';
import { CandidateSummary, JOB_MATCH_SYSTEM, jobMatchUserMessage, JobMatchResultSchema } from './prompts/job-match.prompt';

/**
 * Called with listings that scored at or above the user's auto-tailor
 * threshold. Bound by the tailoring feature; absent, scoring simply stops here.
 */
export interface HighMatchHandler {
  onHighMatch(userId: string, listings: JobListing[]): Promise<void>;
}

export const HIGH_MATCH_HANDLER = 'services.HighMatchHandler';

/** Scores a small batch of pre-filtered listings in one model call (small model class). */
@injectable({ scope: BindingScope.TRANSIENT })
export class JobMatchService {
  constructor(
    @inject('repositories.JobListingRepository') private listings: JobListingRepository,
    @inject('services.CandidateProfileService') private profiles: CandidateProfileService,
    @inject('services.ResumeService') private resumes: ResumeService,
    @inject('services.LlmRouterService') private llm: LlmRouterService,
    @inject('services.LoggerService') private logger: LoggerService,
    @inject(HIGH_MATCH_HANDLER, { optional: true }) private highMatch?: HighMatchHandler,
  ) {}

  async scoreBatch({ userId, listingIds }: JobMatchJob): Promise<void> {
    const batch = (await this.listings.findOwned(userId, { where: { id: { inq: listingIds } } })).filter(
      listing => listing.matchStatus === MatchStatus.PENDING,
    );
    if (batch.length === 0) return;

    const profile = await this.profiles.get(userId);
    const candidate = await this.candidateSummary(userId, profile.targetTitles, profile.skills, profile.yearsExperience);
    const numbered = batch.map((listing, index) => ({ ...listing, promptId: String(index + 1) }));

    try {
      const { value } = await this.llm.completeJson(
        {
          task: LlmTask.JOB_MATCH_SCORE,
          system: JOB_MATCH_SYSTEM,
          messages: [
            {
              role: 'user',
              content: jobMatchUserMessage(
                candidate,
                numbered.map(listing => ({ id: listing.promptId, title: listing.title, company: listing.company, location: listing.location, description: listing.description })),
              ),
            },
          ],
          userId,
        },
        JobMatchResultSchema,
      );

      const byId = new Map(value.results.map(result => [result.id, result]));
      const highMatches: JobListing[] = [];
      for (const listing of numbered) {
        const result = byId.get(listing.promptId);
        if (!result) {
          await this.listings.updateById(listing.id!, { matchStatus: MatchStatus.FAILED, matchReason: 'The model did not score this job' });
          continue;
        }
        const score = Math.round(result.score);
        await this.listings.updateById(listing.id!, {
          matchStatus: MatchStatus.SCORED,
          matchScore: score,
          matchReason: result.reason,
          matchedSkills: result.matchedSkills,
          missingSkills: result.missingSkills,
        });
        if (score >= profile.autoTailorThreshold) highMatches.push(await this.listings.findById(listing.id!));
      }
      if (highMatches.length > 0 && this.highMatch) await this.highMatch.onHighMatch(userId, highMatches);
    } catch (error) {
      const reason = error instanceof AppError ? `${error.code}: ${error.message}` : 'Scoring failed';
      this.logger.warn('Job scoring failed', { userId, count: batch.length, error: (error as Error).message });
      for (const listing of batch) {
        await this.listings.updateById(listing.id!, { matchStatus: MatchStatus.FAILED, matchReason: reason });
      }
    }
  }

  private async candidateSummary(userId: string, targetTitles: string[], skills: string[], yearsExperience?: number): Promise<CandidateSummary> {
    const resume = await this.resumes.primaryParsed(userId).catch(() => undefined);
    const recentRoles = (resume?.document?.experience ?? []).slice(0, 3).map(role => `${role.title} at ${role.company}`);
    return { targetTitles, skills: skills.slice(0, 40), yearsExperience, recentRoles };
  }
}
