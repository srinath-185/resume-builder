import { inject } from '@loopback/core';
import { MongoDataSource } from '../datasources';
import { User } from '../models';
import { TimestampedRepository } from './base/crud-base';

export class UserRepository extends TimestampedRepository<User> {
  constructor(@inject('datasources.mongo') dataSource: MongoDataSource) {
    super(User, dataSource);
  }

  findByEmail(email: string): Promise<User | null> {
    return this.findOne({ where: { email: normaliseEmail(email) } });
  }
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}
