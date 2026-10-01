import { inject } from '@loopback/core';
import { MongoDataSource } from '../datasources';
import { CandidateProfile, Resume } from '../models';
import { OwnedRepository } from './base/crud-base';

export class ResumeRepository extends OwnedRepository<Resume> {
  constructor(@inject('datasources.mongo') dataSource: MongoDataSource) {
    super(Resume, dataSource);
  }
}

export class CandidateProfileRepository extends OwnedRepository<CandidateProfile> {
  constructor(@inject('datasources.mongo') dataSource: MongoDataSource) {
    super(CandidateProfile, dataSource);
  }

  findForUser(userId: string): Promise<CandidateProfile | null> {
    return this.findOne({ where: { userId } });
  }
}
