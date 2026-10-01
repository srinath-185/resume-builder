import { inject } from '@loopback/core';
import { MongoDataSource } from '../datasources';
import { JobListing, JobSourceSetting } from '../models';
import { OwnedRepository } from './base/crud-base';

export class JobListingRepository extends OwnedRepository<JobListing> {
  constructor(@inject('datasources.mongo') dataSource: MongoDataSource) {
    super(JobListing, dataSource);
  }
}

export class JobSourceSettingRepository extends OwnedRepository<JobSourceSetting> {
  constructor(@inject('datasources.mongo') dataSource: MongoDataSource) {
    super(JobSourceSetting, dataSource);
  }
}
