import { inject, lifeCycleObserver, LifeCycleObserver } from '@loopback/core';
import { MongoDataSource } from '../datasources';
import { UserRole, UserStatus } from '../models';
import { LoggerService } from '../services/common/logger.service';

interface MongoCollection {
  updateMany(filter: object, update: object): Promise<{ modifiedCount?: number }>;
}

/**
 * Accounts created before roles existed have no role/status/tokenVersion.
 * Code reads them safely either way (roleOf, statusOf); this fills the fields
 * in so admin filters by role or status also match those accounts.
 * Runs on the raw collection because juggler's `exists` filter does not reach
 * Mongo as `$exists`. Idempotent; skipped for non-Mongo (test) datasources.
 */
@lifeCycleObserver('migration')
export class UserBackfillObserver implements LifeCycleObserver {
  constructor(
    @inject('datasources.mongo') private dataSource: MongoDataSource,
    @inject('services.LoggerService') private logger: LoggerService,
  ) {}

  async start(): Promise<void> {
    const connector = this.dataSource.connector as { collection?: (name: string) => MongoCollection } | undefined;
    if (typeof connector?.collection !== 'function') return;
    try {
      await this.dataSource.connect();
      const users = connector.collection('users');
      let updated = 0;
      for (const [field, value] of [['role', UserRole.USER], ['status', UserStatus.ACTIVE], ['tokenVersion', 0]] as const) {
        updated += (await users.updateMany({ [field]: { $exists: false } }, { $set: { [field]: value } })).modifiedCount ?? 0;
      }
      if (updated > 0) this.logger.info('Backfilled user roles', { updated });
    } catch (error) {
      // Never block start-up on this; the read helpers already default missing fields.
      this.logger.warn('User role backfill failed', { error: (error as Error).message });
    }
  }
}
