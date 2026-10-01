import { BindingScope, injectable } from '@loopback/core';
import { ApifyLinkedInPostsConnector, HiringPostConnector, SerpApiPostsConnector } from './post-connectors';

/** One instance per post source so circuit breakers persist across searches. */
@injectable({ scope: BindingScope.SINGLETON })
export class PostConnectorRegistryService {
  private connectors: HiringPostConnector[] = [new SerpApiPostsConnector(), new ApifyLinkedInPostsConnector()];

  all(): HiringPostConnector[] {
    return this.connectors;
  }

  get(key: string): HiringPostConnector | undefined {
    return this.connectors.find(connector => connector.info.key === key);
  }

  /** Test seam. */
  replace(connectors: HiringPostConnector[]): void {
    this.connectors = connectors;
  }
}
