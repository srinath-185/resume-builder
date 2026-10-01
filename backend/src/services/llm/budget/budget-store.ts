import IORedis from 'ioredis';

/**
 * Counters behind the LLM budget. Memory for a single process (dev/tests);
 * Redis when several processes share one provider account, which is the
 * normal case because free-tier limits are per organisation, not per process.
 */
export interface BudgetStore {
  increment(key: string, by: number, ttlSeconds: number): Promise<number>;
  get(key: string): Promise<number>;
  setUntil(key: string, untilEpochMs: number): Promise<void>;
  getUntil(key: string): Promise<number | undefined>;
}

export class MemoryBudgetStore implements BudgetStore {
  private readonly counters = new Map<string, { value: number; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async increment(key: string, by: number, ttlSeconds: number): Promise<number> {
    const current = this.live(key);
    const next = { value: (current?.value ?? 0) + by, expiresAt: current?.expiresAt ?? this.now() + ttlSeconds * 1000 };
    this.counters.set(key, next);
    return next.value;
  }

  async get(key: string): Promise<number> {
    return this.live(key)?.value ?? 0;
  }

  async setUntil(key: string, untilEpochMs: number): Promise<void> {
    this.counters.set(key, { value: untilEpochMs, expiresAt: untilEpochMs });
  }

  async getUntil(key: string): Promise<number | undefined> {
    return this.live(key)?.value;
  }

  private live(key: string): { value: number; expiresAt: number } | undefined {
    const entry = this.counters.get(key);
    if (entry && entry.expiresAt <= this.now()) {
      this.counters.delete(key);
      return undefined;
    }
    return entry;
  }
}

export class RedisBudgetStore implements BudgetStore {
  constructor(private readonly redis: IORedis) {}

  async increment(key: string, by: number, ttlSeconds: number): Promise<number> {
    const results = await this.redis.multi().incrby(key, by).expire(key, ttlSeconds, 'NX').exec();
    return Number(results?.[0]?.[1] ?? 0);
  }

  async get(key: string): Promise<number> {
    return Number((await this.redis.get(key)) ?? 0);
  }

  async setUntil(key: string, untilEpochMs: number): Promise<void> {
    const ttl = Math.max(1, untilEpochMs - Date.now());
    await this.redis.set(key, String(untilEpochMs), 'PX', ttl);
  }

  async getUntil(key: string): Promise<number | undefined> {
    const value = await this.redis.get(key);
    return value === null ? undefined : Number(value);
  }
}
