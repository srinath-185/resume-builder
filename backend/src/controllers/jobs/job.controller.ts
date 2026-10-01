import { authenticate } from '@loopback/authentication';
import { inject } from '@loopback/core';
import { get, param, patch, post, put, requestBody } from '@loopback/rest';
import { SecurityBindings, UserProfile } from '@loopback/security';
import { currentUserId } from '../../authentication/jwt.strategy';
import { PaginatedResult, parsePage } from '../../common/utils/list-query.util';
import { JobListing, JobListingStatus } from '../../models';
import { JobDiscoveryService } from '../../services/jobs/job-discovery.service';
import { JobListingService } from '../../services/jobs/job-listing.service';
import { JobSourceService, JobSourceView } from '../../services/jobs/job-source.service';

@authenticate('jwt')
export class JobController {
  constructor(
    @inject('services.JobListingService') private listings: JobListingService,
    @inject('services.JobDiscoveryService') private discovery: JobDiscoveryService,
    @inject('services.JobSourceService') private sources: JobSourceService,
  ) {}

  @get('/job-sources')
  listSources(@inject(SecurityBindings.USER) profile: UserProfile): Promise<JobSourceView[]> {
    return this.sources.list(currentUserId(profile));
  }

  @put('/job-sources/{key}')
  setSource(
    @inject(SecurityBindings.USER) profile: UserProfile,
    @param.path.string('key') key: string,
    @requestBody({
      content: {
        'application/json': {
          schema: { type: 'object', required: ['enabled'], additionalProperties: false, properties: { enabled: { type: 'boolean' } } },
        },
      },
    })
    body: { enabled: boolean },
  ): Promise<JobSourceView> {
    return this.sources.setEnabled(currentUserId(profile), key, body.enabled);
  }

  /** Search all enabled sources now (rate-limited). Results arrive in the background. */
  @post('/jobs/discover')
  discover(@inject(SecurityBindings.USER) profile: UserProfile): Promise<{ jobId: string }> {
    return this.discovery.requestRun(currentUserId(profile));
  }

  @get('/jobs')
  list(
    @inject(SecurityBindings.USER) profile: UserProfile,
    @param.query.string('status') status?: JobListingStatus,
    @param.query.number('minScore') minScore?: number,
    @param.query.string('source') source?: string,
    @param.query.string('q') search?: string,
    @param.query.boolean('includeFiltered') includeFiltered?: boolean,
    @param.query.number('page') page?: number,
    @param.query.number('limit') limit?: number,
  ): Promise<PaginatedResult<JobListing>> {
    const validStatus = status && Object.values(JobListingStatus).includes(status) ? status : undefined;
    return this.listings.list(currentUserId(profile), { status: validStatus, minScore, source, search, includeFiltered }, parsePage(page, limit));
  }

  @get('/jobs/{id}')
  findById(@inject(SecurityBindings.USER) profile: UserProfile, @param.path.string('id') id: string): Promise<JobListing> {
    return this.listings.get(currentUserId(profile), id);
  }

  @patch('/jobs/{id}/status')
  setStatus(
    @inject(SecurityBindings.USER) profile: UserProfile,
    @param.path.string('id') id: string,
    @requestBody({
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['status'],
            additionalProperties: false,
            properties: { status: { type: 'string', enum: Object.values(JobListingStatus) } },
          },
        },
      },
    })
    body: { status: JobListingStatus },
  ): Promise<JobListing> {
    return this.listings.setStatus(currentUserId(profile), id, body.status);
  }

  @post('/jobs/{id}/rescore')
  rescore(@inject(SecurityBindings.USER) profile: UserProfile, @param.path.string('id') id: string): Promise<JobListing> {
    return this.listings.rescore(currentUserId(profile), id);
  }
}
