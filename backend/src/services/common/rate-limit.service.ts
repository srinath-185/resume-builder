import { BindingScope, injectable } from '@loopback/core';
import IORedis from 'ioredis';
import { envString } from '../../common/config/env.util';
import { AppRateLimitError, ERROR_CODES } from '../../common/errors';
import { BudgetStore, MemoryBudgetStore, RedisBudgetStore } from '../llm/budget/budget-store';

export interface RateRule {
  /** Most events allowed per window. */
  limit: number;
  windowSeconds: number;
}

/**
 * Fixed-window counters for abuse limits (login failures, sign-ups). Shared
 * through Redis when REDIS_URL is set so every API process sees the same
 * counts; in memory otherwise.
 */
@injectable({ scope: BindingScope.SINGLETON })
export class RateLimitService {
  private store: BudgetStore;

  constructor() {
    const redisUrl = envString('REDIS_URL');
    const useRedis = envString('RATE_LIMIT_STORE', redisUrl ? 'redis' : 'memory') === 'redis' && redisUrl;
    this.store = useRedis ? new RedisBudgetStore(new IORedis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 })) : new MemoryBudgetStore();
  }

  /** Test seam. */
  useStore(store: BudgetStore): void {
    this.store = store;
  }

  /** Throws RATE_LIMITED when `key` has already reached the rule's limit; does not count. */
  async assertUnder(key: string, rule: RateRule): Promise<void> {
    if (rule.limit > 0 && (await this.store.get(this.key(key))) >= rule.limit) {
      throw new AppRateLimitError(ERROR_CODES.RATE_LIMITED, 'Too many attempts. Try again later.', { retryAfterSeconds: rule.windowSeconds });
    }
  }

  async record(key: string, rule: RateRule): Promise<number> {
    return this.store.increment(this.key(key), 1, rule.windowSeconds);
  }

  /** Counts one event, then refuses it if that took the key over the limit. */
  async consume(key: string, rule: RateRule): Promise<void> {
    if (rule.limit > 0 && (await this.record(key, rule)) > rule.limit) {
      throw new AppRateLimitError(ERROR_CODES.RATE_LIMITED, 'Too many attempts. Try again later.', { retryAfterSeconds: rule.windowSeconds });
    }
  }

  async reset(key: string): Promise<void> {
    await this.store.delete(this.key(key));
  }

  private key(key: string): string {
    return `ratelimit:${key}`;
  }
}
