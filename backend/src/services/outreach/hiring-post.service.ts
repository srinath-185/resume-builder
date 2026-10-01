import { BindingScope, inject, injectable } from '@loopback/core';
import { envInt } from '../../common/config/env.util';
import { AppBusinessError, AppNotFoundError, AppRateLimitError, ERROR_CODES } from '../../common/errors';
import { buildHiringQuery, canonicalPostUrl, DEFAULT_HIRING_QUERY_TEMPLATE, extractEmails } from '../../domain/hiring-query';
import { ContactSource, HiringPost, HiringPostStatus, JobSourceSetting } from '../../models';
import { QueueService } from '../../queue/queue.service';
import { HiringPostRepository, JobSourceSettingRepository } from '../../repositories';
import { AuditService } from '../audit/audit.service';
import { LoggerService } from '../common/logger.service';
import { CandidateProfileService } from '../resume/candidate-profile.service';
import { ContactService } from './contact.service';
import { PostConnectorRegistryService } from './post-connector-registry.service';
import { PostConnectorInfo } from './post-connectors';

export const HIRING_POST_QUEUE = 'hiring-post-search';

export interface HiringPostJob {
  userId: string;
}

export interface PostSourceView extends PostConnectorInfo {
  configured: boolean;
  enabled: boolean;
  lastRunAt?: Date;
  lastFound?: number;
  lastError?: string;
}

export interface HiringSearchSummary {
  queries: string[];
  found: number;
  created: number;
  contactsCreated: number;
  errors: Array<{ source: string; message: string }>;
}

const MAX_TITLES = 3;

/**
 * Builds the "hiring" + title (+ location) query per target title, runs it on
 * every enabled post source, stores new posts and turns any email in a post
 * into a recruiter contact.
 */
@injectable({ scope: BindingScope.TRANSIENT })
export class HiringPostService {
  constructor(
    @inject('repositories.HiringPostRepository') private posts: HiringPostRepository,
    @inject('repositories.JobSourceSettingRepository') private settings: JobSourceSettingRepository,
    @inject('services.CandidateProfileService') private profiles: CandidateProfileService,
    @inject('services.ContactService') private contacts: ContactService,
    @inject('services.QueueService') private queue: QueueService,
    @inject('services.AuditService') private audit: AuditService,
    @inject('services.LoggerService') private logger: LoggerService,
    @inject('services.PostConnectorRegistryService') private registry: PostConnectorRegistryService,
  ) {}

  async queries(userId: string): Promise<string[]> {
    const profile = await this.profiles.get(userId);
    const template = profile.hiringQueryTemplate || DEFAULT_HIRING_QUERY_TEMPLATE;
    const location = profile.remoteOnly ? 'remote' : profile.location;
    return profile.targetTitles.slice(0, MAX_TITLES).map(title => buildHiringQuery(template, title, location));
  }

  async sources(userId: string): Promise<PostSourceView[]> {
    const saved = new Map((await this.settings.findOwned(userId)).map(setting => [setting.connectorKey, setting]));
    return this.registry.all().map(connector => {
      const setting = saved.get(connector.info.key);
      return {
        ...connector.info,
        configured: connector.isConfigured(),
        enabled: setting?.enabled ?? connector.info.official,
        lastRunAt: setting?.lastRunAt,
        lastFound: setting?.lastFound,
        lastError: setting?.lastError,
      };
    });
  }

  async setSourceEnabled(userId: string, key: string, enabled: boolean): Promise<PostSourceView> {
    if (!this.registry.all().some(connector => connector.info.key === key)) {
      throw new AppNotFoundError(ERROR_CODES.JOB_SOURCE_UNKNOWN, `Unknown post source "${key}"`);
    }
    await this.saveSetting(userId, key, { enabled });
    return (await this.sources(userId)).find(view => view.key === key)!;
  }

  async requestSearch(userId: string): Promise<{ jobId: string; queries: string[] }> {
    const queries = await this.queries(userId);
    if (queries.length === 0) throw new AppBusinessError(ERROR_CODES.PROFILE_INCOMPLETE, 'Add at least one target job title to your profile first');
    const minMinutes = envInt('HIRING_POST_MIN_INTERVAL_MINUTES', 60);
    const lastRun = Math.max(0, ...(await this.sources(userId)).map(view => view.lastRunAt?.getTime() ?? 0));
    if (Date.now() - lastRun < minMinutes * 60_000) {
      throw new AppRateLimitError(ERROR_CODES.DISCOVERY_TOO_SOON, `Post searches can run at most every ${minMinutes} minutes`);
    }
    const jobId = await this.queue.enqueue<HiringPostJob>(HIRING_POST_QUEUE, { userId }, { jobId: `posts-${userId}-${Math.floor(Date.now() / 60_000)}` });
    return { jobId, queries };
  }

  async search({ userId }: HiringPostJob): Promise<HiringSearchSummary> {
    const profile = await this.profiles.get(userId);
    const queries = await this.queries(userId);
    const summary: HiringSearchSummary = { queries, found: 0, created: 0, contactsCreated: 0, errors: [] };
    const enabledKeys = new Set((await this.sources(userId)).filter(view => view.enabled && view.configured).map(view => view.key));
    const limit = envInt('HIRING_POSTS_PER_QUERY', 20);

    for (const connector of this.registry.all().filter(candidate => enabledKeys.has(candidate.info.key))) {
      let found = 0;
      let error: string | undefined;
      for (const [index, query] of queries.entries()) {
        try {
          const results = await connector.search(query, limit);
          found += results.length;
          for (const raw of results) {
            const created = await this.store(userId, raw, query, profile.targetTitles[index]);
            if (!created) continue;
            summary.created++;
            summary.contactsCreated += await this.contacts.upsertDiscovered(userId, created.extractedEmails, ContactSource.POST, created.id!, created.author);
          }
        } catch (caught) {
          error = (caught as Error).message;
          this.logger.warn('Hiring post source failed', { source: connector.info.key, error });
          summary.errors.push({ source: connector.info.key, message: error });
        }
      }
      summary.found += found;
      await this.saveSetting(userId, connector.info.key, { lastRunAt: new Date(), lastFound: found, lastError: error });
    }

    await this.audit.record({ userId, action: 'HIRING_POSTS_SEARCHED', entity: 'HiringPost', meta: { ...summary } });
    return summary;
  }

  list(userId: string, status?: HiringPostStatus): Promise<HiringPost[]> {
    const where = status && Object.values(HiringPostStatus).includes(status) ? { status } : undefined;
    return this.posts.findOwned(userId, { where, order: ['createdAt DESC'], limit: 200 });
  }

  get(userId: string, id: string): Promise<HiringPost> {
    return this.posts.findOwnedById(userId, id, {}, ERROR_CODES.HIRING_POST_NOT_FOUND);
  }

  async setStatus(userId: string, id: string, status: HiringPostStatus): Promise<HiringPost> {
    await this.get(userId, id);
    await this.posts.updateById(id, { status });
    return this.get(userId, id);
  }

  private async store(userId: string, raw: { source: string; url: string; author?: string; authorUrl?: string; text: string; postedAt?: Date }, query: string, title?: string) {
    const postUrl = canonicalPostUrl(raw.url);
    if (await this.posts.findOne({ where: { userId, postUrl } })) return undefined;
    return this.posts.create({
      userId,
      source: raw.source,
      postUrl,
      author: raw.author,
      authorUrl: raw.authorUrl,
      text: raw.text.slice(0, 5000),
      extractedEmails: extractEmails(raw.text),
      queryUsed: query,
      title,
      postedAt: raw.postedAt,
      status: HiringPostStatus.NEW,
    });
  }

  private async saveSetting(userId: string, connectorKey: string, data: Partial<JobSourceSetting>): Promise<void> {
    const existing = await this.settings.findOne({ where: { userId, connectorKey } });
    if (existing) {
      await this.settings.updateById(existing.id!, data);
      return;
    }
    const official = this.registry.all().find(connector => connector.info.key === connectorKey)?.info.official ?? false;
    await this.settings.create({ userId, connectorKey, enabled: official, ...data });
  }
}
