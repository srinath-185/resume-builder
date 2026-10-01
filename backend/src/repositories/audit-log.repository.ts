import { inject } from '@loopback/core';
import { MongoDataSource } from '../datasources';
import { AuditLog } from '../models';
import { TimestampedRepository } from './base/crud-base';

export class AuditLogRepository extends TimestampedRepository<AuditLog> {
  constructor(@inject('datasources.mongo') dataSource: MongoDataSource) {
    super(AuditLog, dataSource);
  }
}
