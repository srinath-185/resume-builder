import { BindingScope, inject, injectable } from '@loopback/core';
import { envInt } from '../../common/config/env.util';
import { AppBusinessError, AppRateLimitError, ERROR_CODES } from '../../common/errors';
import { jobFingerprint, JobSearchQuery, NormalisedJob } from '../../domain/job-normalise';
import { keywordScore } from '../../domain/keyword-match';
import { CandidateProfile, JobListing, JobListingStatus, MatchStatus } from '../../models';
import { QueueService } from '../../queue/queue.service';
import { JobListingRepository } from '../../repositories';
import { AuditService } from '../audit/audit.service';
import { LoggerService } from '../common/logger.service';
import { CandidateProfileService } from '../resume/candidate-profile.service';
import { JobSourceConnector } from './connectors/job-source.connector';
import { JobSourceService } from './job-source.service';

export const JOB_DISCOVERY_QUEUE = 'job-discovery';
export const JOB_MATCH_QUEUE = 'job-match';

export interface JobDiscoveryJob {
  userId: string;
}

export interface JobMatchJob {
  userId: string;
  listingIds: string[];
}

export interface DiscoverySummary {
  found: number;
  created: number;
  duplicates: number;
  queuedForScoring: number;
  filteredOut: number;
  errors: Array<{ source: string; message: string }>;
}

const MAX_TITLES_PER_RUN = 3;

interface MergedJob {
  job: NormalisedJob;
  sources: string[];
  applyOptions: NonNullable<NormalisedJob['applyOptions']>;
}

/**
 * Searches every active source for each target title, merges duplicates by
 * fingerprint (same company + title + city), applies the keyword pre-filter,
 * and queues only the survivors for model scoring in small batches.
 */
@injectable({ scope: BindingScope.TRANSIENT })
export class JobDiscoveryService {
  constructor(
    @inject('services.CandidateProfileService') private profiles: CandidateProfileService,
    @inject('services.JobSourceService') private sources: JobSourceService,
    @inject('repositories.JobListingRepository') private listings: JobListingRepository,
    @inject('services.QueueService') private queue: QueueService,
    @inject('services.AuditService') private audit: AuditService,
    @inject('services.LoggerService') private logger: LoggerService,
  ) {}

  /** Manual "search now". Rate-limited so a user cannot burn the shared API quotas. */
  async requestRun(userId: string): Promise<{ jobId: string }> {
    const profile = await this.profiles.get(userId);
    if (profile.targetTitles.length === 0) {
      throw new AppBusinessError(ERROR_CODES.PROFILE_INCOMPLETE, 'Add at least one target job title to your profile first');
    }
    const minMinutes = envInt('DISCOVERY_MIN_INTERVAL_MINUTES', 10);
    const lastRun = Math.max(0, ...(await this.sources.list(userId)).map(view => view.lastRunAt?.getTime() ?? 0));
    if (Date.now() - lastRun < minMinutes * 60_000) {
      throw new AppRateLimitError(ERROR_CODES.DISCOVERY_TOO_SOON, `Searches can run at most every ${minMinutes} minutes`);
    }
    const jobId = await this.queue.enqueue<JobDiscoveryJob>(JOB_DISCOVERY_QUEUE, { userId }, { jobId: `discover-${userId}-${Math.floor(Date.now() / 60_000)}` });
    return { jobId };
  }

  /**
   * Scheduled entry point: queues a run for every user with target titles whose
   * last run is older than JOB_DISCOVERY_INTERVAL_HOURS. The job id is bucketed
   * by hour, so a second scheduler tick (or a second process) cannot double-run.
   */
  async enqueueDueUsers(now = new Date()): Promise<string[]> {
    const intervalMs = envInt('JOB_DISCOVERY_INTERVAL_HOURS', 6) * 3_600_000;
    const hourBucket = Math.floor(now.getTime() / 3_600_000);
    const queued: string[] = [];
    for (const userId of await this.profiles.userIdsWithTargets()) {
      const lastRun = Math.max(0, ...(await this.sources.list(userId)).map(view => view.lastRunAt?.getTime() ?? 0));
      if (now.getTime() - lastRun < intervalMs) continue;
      await this.queue.enqueue<JobDiscoveryJob>(JOB_DISCOVERY_QUEUE, { userId }, { jobId: `discover-${userId}-h${hourBucket}` });
      queued.push(userId);
    }
    return queued;
  }

  async discover({ userId }: JobDiscoveryJob): Promise<DiscoverySummary> {
    const profile = await this.profiles.get(userId);
    const summary: DiscoverySummary = { found: 0, created: 0, duplicates: 0, queuedForScoring: 0, filteredOut: 0, errors: [] };
    if (profile.targetTitles.length === 0) return summary;

    const queries = this.queriesFor(profile);
    const connectors = await this.sources.active(userId);
    const found = new Map<string, MergedJob>();
    for (const connector of connectors) {
      const jobs = await this.searchConnector(userId, connector, queries, summary);
      for (const job of jobs) {
        const fingerprint = jobFingerprint(job);
        const existing = found.get(fingerprint);
        if (!existing) {
          found.set(fingerprint, { job, sources: [job.source], applyOptions: [...(job.applyOptions ?? [])] });
          continue;
        }
        summary.duplicates++;
        if (!existing.sources.includes(job.source)) existing.sources.push(job.source);
        existing.applyOptions.push(...(job.applyOptions ?? []).filter(option => !existing.applyOptions.some(known => known.url === option.url)));
      }
    }
    summary.found = found.size;

    const toScore: string[] = [];
    for (const [fingerprint, merged] of found) {
      const created = await this.upsert(userId, fingerprint, merged, profile);
      if (!created) {
        summary.duplicates++;
        continue;
      }
      summary.created++;
      if (created.matchStatus === MatchStatus.PENDING) toScore.push(created.id!);
      else summary.filteredOut++;
    }

    const batchSize = Math.max(1, envInt('MATCH_BATCH_SIZE', 5));
    for (let i = 0; i < toScore.length; i += batchSize) {
      await this.queue.enqueue<JobMatchJob>(JOB_MATCH_QUEUE, { userId, listingIds: toScore.slice(i, i + batchSize) });
    }
    summary.queuedForScoring = toScore.length;

    await this.audit.record({ userId, action: 'JOBS_DISCOVERED', entity: 'JobListing', meta: { ...summary } });
    return summary;
  }

  queriesFor(profile: CandidateProfile): JobSearchQuery[] {
    const limit = envInt('JOBS_PER_QUERY', 20);
    return profile.targetTitles.slice(0, MAX_TITLES_PER_RUN).map(title => ({
      title,
      location: profile.remoteOnly ? undefined : profile.location || undefined,
      remoteOnly: profile.remoteOnly,
      limit,
    }));
  }

  private async searchConnector(
    userId: string,
    connector: JobSourceConnector,
    queries: JobSearchQuery[],
    summary: DiscoverySummary,
  ): Promise<NormalisedJob[]> {
    const results: NormalisedJob[] = [];
    let error: string | undefined;
    for (const query of queries) {
      try {
        results.push(...(await connector.search(query)));
      } catch (caught) {
        error = (caught as Error).message;
        this.logger.warn('Job source failed', { source: connector.info.key, error });
        summary.errors.push({ source: connector.info.key, message: error });
      }
    }
    await this.sources.recordRun(userId, connector.info.key, { found: results.length, error });
    return results;
  }

  /** Returns the new listing, or undefined when it already existed (then only its sources are merged). */
  private async upsert(userId: string, fingerprint: string, merged: MergedJob, profile: CandidateProfile): Promise<JobListing | undefined> {
    const { job } = merged;
    const existing = await this.listings.findOne({ where: { userId, fingerprint } });
    if (existing) {
      const newSources = merged.sources.filter(source => !existing.seenOn.includes(source));
      if (newSources.length > 0) {
        const knownUrls = new Set(existing.applyOptions.map(option => option.url));
        await this.listings.updateById(existing.id!, {
          seenOn: [...existing.seenOn, ...newSources],
          applyOptions: [...existing.applyOptions, ...merged.applyOptions.filter(option => !knownUrls.has(option.url))],
        });
      }
      return undefined;
    }

    const prefilter = keywordScore(`${job.title}\n${job.description}`, job.title, profile.skills, profile.targetTitles);
    const passes = prefilter.score >= envInt('MATCH_PREFILTER_MIN', 25);
    return this.listings.create({
      userId,
      fingerprint,
      source: job.source,
      seenOn: merged.sources,
      externalId: job.externalId,
      title: job.title,
      company: job.company,
      location: job.location,
      remote: job.remote,
      url: job.url,
      applyUrl: job.applyUrl,
      applyOptions: merged.applyOptions,
      description: job.description,
      postedAt: job.postedAt,
      employmentType: job.employmentType,
      salary: job.salary,
      status: JobListingStatus.NEW,
      matchStatus: passes ? MatchStatus.PENDING : MatchStatus.FILTERED_OUT,
      keywordScore: prefilter.score,
      matchedSkills: prefilter.matched,
      missingSkills: prefilter.missing,
    });
  }
}
