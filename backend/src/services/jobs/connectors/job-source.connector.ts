import { JobSearchQuery, NormalisedJob } from '../../../domain/job-normalise';

export type ConnectorKey = 'jsearch' | 'adzuna' | 'apify-linkedin' | 'apify-naukri';

export interface ConnectorInfo {
  key: ConnectorKey;
  label: string;
  /** Shown in the UI so the user knows what each source actually covers. */
  description: string;
  official: boolean;
}

/**
 * A job source. Implementations talk to one provider through a
 * ResilientHttpClient and map its payload to NormalisedJob. Credentials come
 * from server env; a connector without credentials reports unconfigured and is
 * skipped rather than failing discovery.
 */
export interface JobSourceConnector {
  readonly info: ConnectorInfo;
  isConfigured(): boolean;
  search(query: JobSearchQuery): Promise<NormalisedJob[]>;
}
