import { BindingScope, inject, injectable } from '@loopback/core';
import { JobListing } from '../../models';
import { JdKeywordCacheRepository } from '../../repositories';
import { LlmRouterService } from '../llm/llm-router.service';
import { LlmTask } from '../llm/llm.types';
import { JD_KEYWORDS_SYSTEM, JdKeywordsSchema } from './prompts/tailor.prompts';

export interface JdKeywords {
  mustHave: string[];
  niceToHave: string[];
  seniority?: string;
}

const JD_CHARS_FOR_KEYWORDS = 5000;

/**
 * What a job asks for, extracted once per job fingerprint and shared by every
 * user who sees the same posting (small model class, cached in Mongo).
 */
@injectable({ scope: BindingScope.TRANSIENT })
export class JdKeywordService {
  constructor(
    @inject('repositories.JdKeywordCacheRepository') private cache: JdKeywordCacheRepository,
    @inject('services.LlmRouterService') private llm: LlmRouterService,
  ) {}

  async forListing(listing: JobListing, userId?: string): Promise<JdKeywords> {
    const cached = await this.cache.findOne({ where: { fingerprint: listing.fingerprint } });
    if (cached) return { mustHave: cached.mustHave, niceToHave: cached.niceToHave, seniority: cached.seniority };

    const { value } = await this.llm.completeJson(
      {
        task: LlmTask.JD_KEYWORDS,
        system: JD_KEYWORDS_SYSTEM,
        messages: [{ role: 'user', content: `${listing.title} at ${listing.company}\n\n${listing.description.slice(0, JD_CHARS_FOR_KEYWORDS)}` }],
        userId,
      },
      JdKeywordsSchema,
    );
    await this.cache.create({ fingerprint: listing.fingerprint, ...value }).catch(() => undefined); // lost race: another user cached it
    return value;
  }
}
