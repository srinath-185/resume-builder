import { BindingScope, inject, injectable } from '@loopback/core';
import { Where } from '@loopback/repository';
import { AppBusinessError, ERROR_CODES } from '../../common/errors';
import { PageRequest, PaginatedResult, toPaginated } from '../../common/utils/list-query.util';
import { JobListing, JobListingStatus, MatchStatus } from '../../models';
import { QueueService } from '../../queue/queue.service';
import { JobListingRepository } from '../../repositories';
import { AuditService } from '../audit/audit.service';
import { JobMatchJob, JOB_MATCH_QUEUE } from './job-discovery.service';

export interface JobListFilters {
  status?: JobListingStatus;
  minScore?: number;
  source?: string;
  search?: string;
  includeFiltered?: boolean;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@injectable({ scope: BindingScope.TRANSIENT })
export class JobListingService {
  constructor(
    @inject('repositories.JobListingRepository') private listings: JobListingRepository,
    @inject('services.QueueService') private queue: QueueService,
    @inject('services.AuditService') private audit: AuditService,
  ) {}

  async list(userId: string, filters: JobListFilters, page: PageRequest): Promise<PaginatedResult<JobListing>> {
    const clauses: Where<JobListing>[] = [];
    if (filters.status) clauses.push({ status: filters.status });
    if (filters.source) clauses.push({ seenOn: filters.source } as Where<JobListing>);
    if (filters.minScore !== undefined) clauses.push({ matchScore: { gte: filters.minScore } });
    if (!filters.includeFiltered) clauses.push({ matchStatus: { neq: MatchStatus.FILTERED_OUT } });
    if (filters.search) {
      const pattern = new RegExp(escapeRegex(filters.search.trim().slice(0, 80)), 'i');
      clauses.push({ or: [{ title: { regexp: pattern } }, { company: { regexp: pattern } }] });
    }
    const where = clauses.length ? ({ and: clauses } as Where<JobListing>) : undefined;
    const [items, count] = await Promise.all([
      this.listings.findOwned(userId, {
        where,
        order: ['matchScore DESC', 'keywordScore DESC', 'createdAt DESC'],
        limit: page.limit,
        skip: page.skip,
        fields: { description: false },
      }),
      this.listings.countOwned(userId, where),
    ]);
    return toPaginated(items, count.count, page);
  }

  get(userId: string, id: string): Promise<JobListing> {
    return this.listings.findOwnedById(userId, id, {}, ERROR_CODES.JOB_NOT_FOUND);
  }

  async setStatus(userId: string, id: string, status: JobListingStatus): Promise<JobListing> {
    const before = await this.get(userId, id);
    await this.listings.updateById(id, { status });
    await this.audit.record({ userId, action: 'JOB_STATUS_CHANGED', entity: 'JobListing', entityId: id, before: { status: before.status }, after: { status } });
    return this.get(userId, id);
  }

  async rescore(userId: string, id: string): Promise<JobListing> {
    const listing = await this.get(userId, id);
    if (listing.matchStatus === MatchStatus.PENDING) {
      throw new AppBusinessError(ERROR_CODES.JOB_SCORING_IN_PROGRESS, 'This job is already queued for scoring');
    }
    await this.listings.updateById(id, { matchStatus: MatchStatus.PENDING, matchScore: undefined, matchReason: undefined });
    await this.queue.enqueue<JobMatchJob>(JOB_MATCH_QUEUE, { userId, listingIds: [id] });
    return this.get(userId, id);
  }
}
