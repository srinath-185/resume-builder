import { BindingScope, injectable } from '@loopback/core';
import { AdzunaConnector } from './connectors/adzuna.connector';
import { createApifyLinkedInConnector, createApifyNaukriConnector } from './connectors/apify.connector';
import { ConnectorKey, JobSourceConnector } from './connectors/job-source.connector';
import { JSearchConnector } from './connectors/jsearch.connector';

/** One instance per connector so circuit breakers persist across discovery runs. */
@injectable({ scope: BindingScope.SINGLETON })
export class ConnectorRegistryService {
  private connectors: JobSourceConnector[] = [
    new JSearchConnector(),
    new AdzunaConnector(),
    createApifyLinkedInConnector(),
    createApifyNaukriConnector(),
  ];

  all(): JobSourceConnector[] {
    return this.connectors;
  }

  get(key: string): JobSourceConnector | undefined {
    return this.connectors.find(connector => connector.info.key === key);
  }

  isKnown(key: string): key is ConnectorKey {
    return this.get(key) !== undefined;
  }

  /** Test seam. */
  replace(connectors: JobSourceConnector[]): void {
    this.connectors = connectors;
  }
}
