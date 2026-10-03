import { envString } from '../../../common/config/env.util';
import { ResilientHttpClient } from '../../../common/http/resilient-http.client';
import { clipDescription, JobSearchQuery, NormalisedJob, safeUrl, stripHtml, toDate } from '../../../domain/job-normalise';
import { ConnectorInfo, JobSourceConnector } from './job-source.connector';

interface JSearchJob {
  job_id?: string;
  job_title?: string;
  employer_name?: string;
  job_location?: string;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_is_remote?: boolean;
  job_apply_link?: string;
  job_google_link?: string;
  job_description?: string;
  job_posted_at_datetime_utc?: string;
  job_employment_type?: string;
  job_min_salary?: number | null;
  job_max_salary?: number | null;
  job_salary_currency?: string | null;
  job_salary_period?: string | null;
  apply_options?: Array<{ publisher?: string; apply_link?: string; is_direct?: boolean }>;
}

const HOST = 'jsearch.p.rapidapi.com';

/**
 * JSearch (RapidAPI) aggregates Google for Jobs, which indexes LinkedIn,
 * Indeed, Naukri, Glassdoor and company career pages — the broadest legal
 * source, so it is the backbone. apply_options keeps every portal's link.
 */
export class JSearchConnector implements JobSourceConnector {
  readonly info: ConnectorInfo = {
    key: 'jsearch',
    label: 'JSearch (Google for Jobs)',
    description: 'Aggregates LinkedIn, Indeed, Naukri, Glassdoor and career pages via Google for Jobs.',
    official: true,
  };

  constructor(private readonly http = new ResilientHttpClient({ name: 'jsearch', timeoutMs: 30_000, retries: 2 })) {}

  isConfigured(): boolean {
    return envString('JSEARCH_API_KEY') !== undefined;
  }

  async search(query: JobSearchQuery): Promise<NormalisedJob[]> {
    const text = [query.title, query.location ? `in ${query.location}` : ''].filter(Boolean).join(' ');
    // /search was retired; /search-v2 nests the list under data.jobs.
    const response = await this.http.request<{ data?: JSearchJob[] | { jobs?: JSearchJob[] } }>({
      url: `https://${HOST}/search-v2`,
      headers: { 'X-RapidAPI-Key': envString('JSEARCH_API_KEY')!, 'X-RapidAPI-Host': HOST },
      query: {
        query: text,
        page: 1,
        num_pages: 1,
        date_posted: envString('JSEARCH_DATE_POSTED', 'week'),
        // Without a country JSearch searches the US, even for "… in Chennai".
        country: envString('JSEARCH_COUNTRY'),
        ...(query.remoteOnly ? { work_from_home: 'true' } : {}),
      },
    });
    const data = response.data?.data;
    const jobs = Array.isArray(data) ? data : (data?.jobs ?? []);
    return jobs.slice(0, query.limit).flatMap(job => this.map(job));
  }

  private map(job: JSearchJob): NormalisedJob[] {
    const url = safeUrl(job.job_apply_link) ?? safeUrl(job.job_google_link);
    if (!job.job_id || !job.job_title || !job.employer_name || !url) return [];
    const location = job.job_location ?? ([job.job_city, job.job_state, job.job_country].filter(Boolean).join(', ') || undefined);
    const salary =
      job.job_min_salary && job.job_max_salary
        ? `${job.job_salary_currency ?? ''} ${job.job_min_salary}–${job.job_max_salary} ${job.job_salary_period ?? ''}`.trim()
        : undefined;
    return [
      {
        source: this.info.key,
        externalId: job.job_id,
        title: job.job_title.trim(),
        company: job.employer_name.trim(),
        location,
        remote: job.job_is_remote ?? undefined,
        url,
        applyUrl: safeUrl(job.job_apply_link),
        description: clipDescription(stripHtml(job.job_description ?? '')),
        postedAt: toDate(job.job_posted_at_datetime_utc),
        employmentType: job.job_employment_type ?? undefined,
        salary,
        applyOptions: (job.apply_options ?? []).flatMap(option => {
          const link = safeUrl(option.apply_link);
          return link && option.publisher ? [{ publisher: option.publisher, url: link, isDirect: option.is_direct }] : [];
        }),
      },
    ];
  }
}
