import { envInt, envString } from '../../common/config/env.util';
import { ResilientHttpClient } from '../../common/http/resilient-http.client';
import { authorFromTitle, toGoogleQuery } from '../../domain/hiring-query';
import { safeUrl, stripHtml, toDate } from '../../domain/job-normalise';
import { renderActorInput } from '../jobs/connectors/apify.connector';

export interface RawPost {
  source: string;
  url: string;
  author?: string;
  authorUrl?: string;
  text: string;
  postedAt?: Date;
}

export interface PostConnectorInfo {
  key: 'serpapi-posts' | 'apify-linkedin-posts';
  label: string;
  description: string;
  official: boolean;
}

export interface HiringPostConnector {
  readonly info: PostConnectorInfo;
  isConfigured(): boolean;
  /** `booleanQuery` is the LinkedIn-style query built from the user's template. */
  search(booleanQuery: string, limit: number): Promise<RawPost[]>;
}

interface SerpResult {
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
}

/**
 * Finds public LinkedIn posts through Google (SerpAPI) — no LinkedIn login or
 * scraping involved. Only what Google shows (title + snippet) is available,
 * so emails are found only when the snippet includes them. Free tier is ~100
 * searches/month, hence the long minimum interval.
 */
export class SerpApiPostsConnector implements HiringPostConnector {
  readonly info: PostConnectorInfo = {
    key: 'serpapi-posts',
    label: 'LinkedIn posts via Google (SerpAPI)',
    description: 'Searches public LinkedIn posts indexed by Google. No LinkedIn account used.',
    official: true,
  };

  constructor(private readonly http = new ResilientHttpClient({ name: 'serpapi', timeoutMs: 30_000, retries: 1 })) {}

  isConfigured(): boolean {
    return envString('SERPAPI_KEY') !== undefined;
  }

  async search(booleanQuery: string, limit: number): Promise<RawPost[]> {
    const response = await this.http.request<{ organic_results?: SerpResult[] }>({
      url: 'https://serpapi.com/search.json',
      query: {
        engine: 'google',
        q: `site:linkedin.com/posts ${toGoogleQuery(booleanQuery)}`,
        num: Math.min(limit, 50),
        tbs: envString('SERPAPI_TIME_RANGE', 'qdr:w'),
        api_key: envString('SERPAPI_KEY'),
      },
    });
    return (response.data?.organic_results ?? []).flatMap(result => {
      const url = safeUrl(result.link);
      if (!url || !/linkedin\.com\/(posts|feed)\//i.test(url)) return [];
      return [{ source: this.info.key, url, author: authorFromTitle(result.title), text: stripHtml(`${result.title ?? ''}\n${result.snippet ?? ''}`), postedAt: toDate(result.date) }];
    });
  }
}

type Item = Record<string, unknown>;
const text = (value: unknown) => (typeof value === 'string' ? value : undefined);

/** Unofficial LinkedIn content-search actor on Apify; actor id and input are configuration. */
export class ApifyLinkedInPostsConnector implements HiringPostConnector {
  readonly info: PostConnectorInfo = {
    key: 'apify-linkedin-posts',
    label: 'LinkedIn posts (via Apify)',
    description: 'Unofficial LinkedIn post scraper actor. May break or violate LinkedIn terms; use at your own risk.',
    official: false,
  };

  constructor(private readonly http = new ResilientHttpClient({ name: 'apify-linkedin-posts', timeoutMs: envInt('APIFY_TIMEOUT_MS', 120_000), retries: 1 })) {}

  isConfigured(): boolean {
    return envString('APIFY_TOKEN') !== undefined && envString('APIFY_LINKEDIN_POSTS_ACTOR') !== undefined;
  }

  async search(booleanQuery: string, limit: number): Promise<RawPost[]> {
    const actor = envString('APIFY_LINKEDIN_POSTS_ACTOR')!.replace('/', '~');
    const template = envString('APIFY_LINKEDIN_POSTS_INPUT', '{"searchQueries":["{{title}}"],"maxPosts":"{{limit}}"}')!;
    const input = renderActorInput(template, { title: booleanQuery, location: '', remoteOnly: false, limit });
    const response = await this.http.request<Item[]>({
      url: `https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/run-sync-get-dataset-items`,
      method: 'POST',
      headers: { authorization: `Bearer ${envString('APIFY_TOKEN')}` },
      query: { limit },
      body: input,
    });
    return (Array.isArray(response.data) ? response.data : []).slice(0, limit).flatMap(item => {
      // Field names differ by actor; harvestapi/linkedin-post-search uses linkedinUrl, content, author.linkedinUrl and postedAt.date.
      const url = safeUrl(item.linkedinUrl ?? item.url ?? item.postUrl ?? item.link);
      const body = text(item.content) ?? text(item.text) ?? text(item.postText);
      if (!url || !body) return [];
      const author = item.author && typeof item.author === 'object' ? (item.author as Item) : undefined;
      const posted = item.postedAt && typeof item.postedAt === 'object' ? (item.postedAt as Item) : undefined;
      return [
        {
          source: this.info.key,
          url,
          author: text(item.authorName) ?? text(author?.name),
          authorUrl: safeUrl(item.authorProfileUrl ?? author?.linkedinUrl ?? author?.url),
          text: stripHtml(body),
          postedAt: toDate(posted ? (posted.date ?? posted.timestamp) : (item.postedAt ?? item.postedAtISO ?? item.date)),
        },
      ];
    });
  }
}
