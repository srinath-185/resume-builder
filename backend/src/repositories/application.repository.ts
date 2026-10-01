import { inject } from '@loopback/core';
import { MongoDataSource } from '../datasources';
import { JdKeywordCache, JobApplication, ResumeVariant } from '../models';
import { OwnedRepository, TimestampedRepository } from './base/crud-base';

export class JobApplicationRepository extends OwnedRepository<JobApplication> {
  constructor(@inject('datasources.mongo') dataSource: MongoDataSource) {
    super(JobApplication, dataSource);
  }
}

export class ResumeVariantRepository extends OwnedRepository<ResumeVariant> {
  constructor(@inject('datasources.mongo') dataSource: MongoDataSource) {
    super(ResumeVariant, dataSource);
  }
}

export class JdKeywordCacheRepository extends TimestampedRepository<JdKeywordCache> {
  constructor(@inject('datasources.mongo') dataSource: MongoDataSource) {
    super(JdKeywordCache, dataSource);
  }
}
