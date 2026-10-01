import { inject } from '@loopback/core';
import { MongoDataSource } from '../datasources';
import { LlmUsageLog } from '../models';
import { TimestampedRepository } from './base/crud-base';

export class LlmUsageLogRepository extends TimestampedRepository<LlmUsageLog> {
  constructor(@inject('datasources.mongo') dataSource: MongoDataSource) {
    super(LlmUsageLog, dataSource);
  }
}
