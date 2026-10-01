import { inject, lifeCycleObserver, LifeCycleObserver } from '@loopback/core';
import { juggler } from '@loopback/repository';
import { envString } from '../common/config/env.util';

const DEFAULT_URL = 'mongodb://127.0.0.1:27017/resume_builder';

export function mongoConfig(): object {
  return {
    name: 'mongo',
    connector: 'mongodb',
    url: envString('MONGODB_URL', DEFAULT_URL),
    useNewUrlParser: true,
    useUnifiedTopology: true,
    // Connect on first use so the API can boot (and report health) while Mongo starts.
    lazyConnect: true,
  };
}

/**
 * Tests bind `datasources.config.mongo` to a memory connector config before
 * boot; everything else reads MONGODB_URL.
 */
@lifeCycleObserver('datasource')
export class MongoDataSource extends juggler.DataSource implements LifeCycleObserver {
  static dataSourceName = 'mongo';

  constructor(@inject('datasources.config.mongo', { optional: true }) dsConfig?: object) {
    super(dsConfig ?? mongoConfig());
  }
}
