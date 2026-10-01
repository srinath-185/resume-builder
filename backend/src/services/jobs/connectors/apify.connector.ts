import { envInt, envString } from '../../../common/config/env.util';
import { AppConfigurationError } from '../../../common/errors';
import { ResilientHttpClient } from '../../../common/http/resilient-http.client';
import { clipDescription, JobSearchQuery, NormalisedJob, safeUrl, stripHtml, toDate } from '../../../domain/job-normalise';
import { ConnectorInfo, ConnectorKey, JobSourceConnector } from './job-source.connector';

type Item = Record<string, unknown>;

function pick(item: Item, keys: string[]): unknown {
  for (const key of keys) {
    const path = key.split('.');
    let value: unknown = item;
    for (const segment of path) value = value && typeof value === 'object' ? (value as Item)[segment] : undefined;
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : undefined;
}

/** Replaces {{title}}, {{location}}, {{limit}} in the actor input template, JSON-escaping values. */
export function renderActorInput(template: string, query: JobSearchQuery): unknown {
  const values: Record<string, string> = { title: query.title, location: query.location ?? '', limit: String(query.limit) };
  const rendered = template.replace(/"\{\{(\w+)\}\}"|\{\{(\w+)\}\}/g, (_match, quoted: string | undefined, bare: string | undefined) => {
    const key = (quoted ?? bare)!;
    const value = values[key] ?? '';
    if (quoted) return key === 'limit' ? value : JSON.stringify(value);
    return JSON.stringify(value).slice(1, -1);
  });
  try {
    return JSON.parse(rendered);
  } catch {
    throw new AppConfigurationError('Apify actor input template is not valid JSON after substitution');
  }
}

export interface ApifyConnectorConfig {
  key: Extract<ConnectorKey, 'apify-linkedin' | 'apify-naukri'>;
  label: string;
  description: string;
  actorEnv: string;
  inputEnv: string;
  defaultInput: string;
}

/**
 * Runs a third-party Apify actor synchronously and maps its dataset items.
 * Unofficial: scraping these portals may break their terms and can stop
 * working without notice, which is why the actor id and input shape are
 * configuration and why discovery never depends on these alone.
 */
export class ApifyJobsConnector implements JobSourceConnector {
  readonly info: ConnectorInfo;

  constructor(
    private readonly config: ApifyConnectorConfig,
    private readonly http = new ResilientHttpClient({ name: config.key, timeoutMs: envInt('APIFY_TIMEOUT_MS', 120_000), retries: 1 }),
  ) {
    this.info = { key: config.key, label: config.label, description: config.description, official: false };
  }

  isConfigured(): boolean {
    return envString('APIFY_TOKEN') !== undefined && envString(this.config.actorEnv) !== undefined;
  }

  async search(query: JobSearchQuery): Promise<NormalisedJob[]> {
    const actor = envString(this.config.actorEnv)!.replace('/', '~');
    const input = renderActorInput(envString(this.config.inputEnv, this.config.defaultInput)!, query);
    const response = await this.http.request<Item[]>({
      url: `https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/run-sync-get-dataset-items`,
      method: 'POST',
      headers: { authorization: `Bearer ${envString('APIFY_TOKEN')}` },
      query: { limit: query.limit },
      body: input,
    });
    return (Array.isArray(response.data) ? response.data : []).slice(0, query.limit).flatMap(item => this.map(item));
  }

  private map(item: Item): NormalisedJob[] {
    const title = asText(pick(item, ['title', 'jobTitle', 'positionName', 'position']));
    const company = asText(pick(item, ['companyName', 'company', 'company.name', 'employer', 'companyDetails.name']));
    const url = safeUrl(pick(item, ['jobUrl', 'link', 'url', 'jdURL', 'applyUrl']));
    if (!title || !company || !url) return [];
    const externalId = asText(pick(item, ['id', 'jobId', 'job_id'])) ?? url;
    const description = asText(pick(item, ['description', 'descriptionText', 'jobDescription', 'descriptionHtml'])) ?? '';
    return [
      {
        source: this.info.key,
        externalId,
        title,
        company,
        location: asText(pick(item, ['location', 'jobLocation', 'placeholders.location', 'city'])),
        url,
        applyUrl: safeUrl(pick(item, ['applyUrl', 'applyLink', 'jobApplyUrl'])) ?? url,
        description: clipDescription(stripHtml(description)),
        postedAt: toDate(pick(item, ['postedAt', 'publishedAt', 'postedDate', 'createdDate', 'footerPlaceholderLabel'])),
        employmentType: asText(pick(item, ['employmentType', 'contractType', 'jobType'])),
        salary: asText(pick(item, ['salary', 'salaryInfo', 'placeholders.salary'])),
      },
    ];
  }
}

export function createApifyLinkedInConnector(http?: ResilientHttpClient): ApifyJobsConnector {
  return new ApifyJobsConnector(
    {
      key: 'apify-linkedin',
      label: 'LinkedIn (via Apify)',
      description: 'Unofficial LinkedIn job scraper actor. May break or violate LinkedIn terms; use at your own risk.',
      actorEnv: 'APIFY_LINKEDIN_ACTOR',
      inputEnv: 'APIFY_LINKEDIN_INPUT',
      defaultInput: '{"title":"{{title}}","location":"{{location}}","rows":"{{limit}}"}',
    },
    http,
  );
}

export function createApifyNaukriConnector(http?: ResilientHttpClient): ApifyJobsConnector {
  return new ApifyJobsConnector(
    {
      key: 'apify-naukri',
      label: 'Naukri (via Apify)',
      description: 'Unofficial Naukri scraper actor. May break or violate Naukri terms; use at your own risk.',
      actorEnv: 'APIFY_NAUKRI_ACTOR',
      inputEnv: 'APIFY_NAUKRI_INPUT',
      defaultInput: '{"keyword":"{{title}}","location":"{{location}}","maxJobs":"{{limit}}"}',
    },
    http,
  );
}
