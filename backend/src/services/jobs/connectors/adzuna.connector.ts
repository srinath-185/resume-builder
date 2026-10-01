import { envString } from '../../../common/config/env.util';
import { ResilientHttpClient } from '../../../common/http/resilient-http.client';
import { clipDescription, JobSearchQuery, NormalisedJob, safeUrl, stripHtml, toDate } from '../../../domain/job-normalise';
import { ConnectorInfo, JobSourceConnector } from './job-source.connector';

interface AdzunaJob {
  id?: string | number;
  title?: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  redirect_url?: string;
  description?: string;
  created?: string;
  contract_time?: string;
  salary_min?: number;
  salary_max?: number;
}

/** Adzuna's official free API. Country is fixed per deployment (ADZUNA_COUNTRY, e.g. "in", "gb", "us"). */
export class AdzunaConnector implements JobSourceConnector {
  readonly info: ConnectorInfo = {
    key: 'adzuna',
    label: 'Adzuna',
    description: 'Official job-search API covering 16+ countries.',
    official: true,
  };

  constructor(private readonly http = new ResilientHttpClient({ name: 'adzuna', timeoutMs: 20_000, retries: 2 })) {}

  isConfigured(): boolean {
    return envString('ADZUNA_APP_ID') !== undefined && envString('ADZUNA_APP_KEY') !== undefined;
  }

  async search(query: JobSearchQuery): Promise<NormalisedJob[]> {
    const country = envString('ADZUNA_COUNTRY', 'in')!.toLowerCase();
    const response = await this.http.request<{ results?: AdzunaJob[] }>({
      url: `https://api.adzuna.com/v1/api/jobs/${encodeURIComponent(country)}/search/1`,
      query: {
        app_id: envString('ADZUNA_APP_ID'),
        app_key: envString('ADZUNA_APP_KEY'),
        what: query.remoteOnly ? `${query.title} remote` : query.title,
        where: query.location,
        results_per_page: Math.min(50, query.limit),
        max_days_old: 14,
        'content-type': 'application/json',
      },
    });
    return (response.data?.results ?? []).flatMap(job => this.map(job));
  }

  private map(job: AdzunaJob): NormalisedJob[] {
    const url = safeUrl(job.redirect_url);
    if (job.id === undefined || !job.title || !job.company?.display_name || !url) return [];
    return [
      {
        source: this.info.key,
        externalId: String(job.id),
        title: stripHtml(job.title),
        company: job.company.display_name.trim(),
        location: job.location?.display_name,
        url,
        applyUrl: url,
        description: clipDescription(stripHtml(job.description ?? '')),
        postedAt: toDate(job.created),
        employmentType: job.contract_time,
        salary: job.salary_min && job.salary_max ? `${Math.round(job.salary_min)}–${Math.round(job.salary_max)}` : undefined,
      },
    ];
  }
}
