import { inject } from '@loopback/core';
import { MongoDataSource } from '../datasources';
import { HiringPost, MailConnector, OutreachMessage, OutreachTemplate, RecruiterContact } from '../models';
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

export class MailConnectorRepository extends OwnedRepository<MailConnector> {
  constructor(@inject('datasources.mongo') dataSource: MongoDataSource) {
    super(MailConnector, dataSource);
  }
}

export class OutreachTemplateRepository extends OwnedRepository<OutreachTemplate> {
  constructor(@inject('datasources.mongo') dataSource: MongoDataSource) {
    super(OutreachTemplate, dataSource);
  }
}

export class OutreachMessageRepository extends OwnedRepository<OutreachMessage> {
  constructor(@inject('datasources.mongo') dataSource: MongoDataSource) {
    super(OutreachMessage, dataSource);
  }
}
