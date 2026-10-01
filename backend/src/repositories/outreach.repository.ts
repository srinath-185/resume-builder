import { inject } from '@loopback/core';
import { MongoDataSource } from '../datasources';
import { HiringPost, RecruiterContact } from '../models';
import { OwnedRepository } from './base/crud-base';

export class HiringPostRepository extends OwnedRepository<HiringPost> {
  constructor(@inject('datasources.mongo') dataSource: MongoDataSource) {
    super(HiringPost, dataSource);
  }
}

export class RecruiterContactRepository extends OwnedRepository<RecruiterContact> {
  constructor(@inject('datasources.mongo') dataSource: MongoDataSource) {
    super(RecruiterContact, dataSource);
  }
}
