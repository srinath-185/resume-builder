import { Application } from '@loopback/core';
import { JobSearchQuery, NormalisedJob } from '../../domain/job-normalise';
import { ConnectorRegistryService } from '../../services/jobs/connector-registry.service';
import { ConnectorInfo, ConnectorKey, JobSourceConnector } from '../../services/jobs/connectors/job-source.connector';

export class FakeConnector implements JobSourceConnector {
  readonly info: ConnectorInfo;
  readonly queries: JobSearchQuery[] = [];
  configured = true;
  failWith?: Error;

  constructor(
    key: ConnectorKey,
    public jobs: NormalisedJob[],
    official = true,
  ) {
    this.info = { key, label: key, description: `fake ${key}`, official };
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async search(query: JobSearchQuery): Promise<NormalisedJob[]> {
    this.queries.push(query);
    if (this.failWith) throw this.failWith;
    return this.jobs.map(job => ({ ...job, source: this.info.key }));
  }
}

export async function useFakeConnectors(app: Application, ...connectors: FakeConnector[]): Promise<void> {
  const registry = await app.get<ConnectorRegistryService>('services.ConnectorRegistryService');
  registry.replace(connectors);
}

export function givenJob(overrides: Partial<NormalisedJob> = {}): NormalisedJob {
  return {
    source: 'jsearch',
    externalId: `ext-${Math.random().toString(36).slice(2)}`,
    title: 'Senior Backend Engineer',
    company: 'Globex Pvt Ltd',
    location: 'Chennai, Tamil Nadu, India',
    url: 'https://jobs.example.test/globex/1',
    applyUrl: 'https://jobs.example.test/globex/1/apply',
    description: 'We need Node.js, TypeScript, MongoDB and Redis experience. Kafka is a plus. AWS required.',
    applyOptions: [{ publisher: 'LinkedIn', url: 'https://linkedin.example.test/jobs/1' }],
    ...overrides,
  };
}
