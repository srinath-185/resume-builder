import { BindingScope, injectable } from '@loopback/core';
import IORedis from 'ioredis';
import { envInt, envString } from '../../../common/config/env.util';
import { ProviderName } from '../llm.types';
import { BudgetStore, MemoryBudgetStore, RedisBudgetStore } from './budget-store';

export interface ProviderLimits {
  /** Requests per minute; 0 = unlimited. */
  rpm: number;
  /** Tokens (in + out) per UTC day; 0 = unlimited. */
  tokensPerDay: number;
}

export interface ProviderBudgetStatus extends ProviderLimits {
  provider: ProviderName;
  requestsThisMinute: number;
  tokensToday: number;
  coolingDownUntil?: string;
}

/**
 * Free-tier defaults, deliberately a little under the published caps so the
 * router moves on before the provider starts answering 429. Override per
 * provider with <PROVIDER>_RPM and <PROVIDER>_TOKENS_PER_DAY.
 */
const DEFAULT_LIMITS: Record<ProviderName, ProviderLimits> = {
  groq: { rpm: 28, tokensPerDay: 95_000 },
  gemini: { rpm: 9, tokensPerDay: 200_000 },
  opencode: { rpm: 20, tokensPerDay: 200_000 },
  anthropic: { rpm: 0, tokensPerDay: 0 },
};

const MINUTE_TTL_SECONDS = 120;
const DAY_TTL_SECONDS = 2 * 24 * 3600;

export function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function minuteKey(now: Date): string {
  return now.toISOString().slice(0, 16);
}

/**
 * Tracks each provider's request rate, daily tokens and 429 cool-downs so the
 * LLM router can skip a provider before it is refused, instead of after.
 */
@injectable({ scope: BindingScope.SINGLETON })
export class LlmBudgetService {
  private store: BudgetStore;
  private now: () => Date = () => new Date();

  constructor() {
    const redisUrl = envString('REDIS_URL');
    const useRedis = envString('LLM_BUDGET_STORE', redisUrl ? 'redis' : 'memory') === 'redis' && redisUrl;
    this.store = useRedis ? new RedisBudgetStore(new IORedis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 })) : new MemoryBudgetStore();
  }

  /** Test seam. */
  useStore(store: BudgetStore, clock?: () => Date): void {
    this.store = store;
    if (clock) this.now = clock;
  }

  limitsFor(provider: ProviderName): ProviderLimits {
    const prefix = provider.toUpperCase();
    return {
      rpm: envInt(`${prefix}_RPM`, DEFAULT_LIMITS[provider].rpm),
      tokensPerDay: envInt(`${prefix}_TOKENS_PER_DAY`, DEFAULT_LIMITS[provider].tokensPerDay),
    };
  }

  /** Whether a call estimated at `estimatedTokens` fits. Does not reserve anything. */
  async canUse(provider: ProviderName, estimatedTokens: number): Promise<{ ok: boolean; reason?: string }> {
    const now = this.now();
    const cooldown = await this.store.getUntil(this.cooldownKey(provider));
    if (cooldown && cooldown > now.getTime()) return { ok: false, reason: `cooling down until ${new Date(cooldown).toISOString()}` };

    const limits = this.limitsFor(provider);
    if (limits.rpm > 0 && (await this.store.get(this.rpmKey(provider, now))) >= limits.rpm) {
      return { ok: false, reason: 'requests-per-minute limit reached' };
    }
    if (limits.tokensPerDay > 0 && (await this.store.get(this.tpdKey(provider, now))) + estimatedTokens > limits.tokensPerDay) {
      return { ok: false, reason: 'daily token budget exhausted' };
    }
    return { ok: true };
  }

  async recordRequest(provider: ProviderName): Promise<void> {
    await this.store.increment(this.rpmKey(provider, this.now()), 1, MINUTE_TTL_SECONDS);
  }

  async recordTokens(provider: ProviderName, tokens: number): Promise<void> {
    if (tokens > 0) await this.store.increment(this.tpdKey(provider, this.now()), tokens, DAY_TTL_SECONDS);
  }

  /** After a 429, stay away for Retry-After (or a minute when the provider did not say). */
  async coolDown(provider: ProviderName, retryAfterMs?: number): Promise<void> {
    await this.store.setUntil(this.cooldownKey(provider), this.now().getTime() + (retryAfterMs ?? 60_000));
  }

  async status(provider: ProviderName): Promise<ProviderBudgetStatus> {
    const now = this.now();
    const cooldown = await this.store.getUntil(this.cooldownKey(provider));
    return {
      provider,
      ...this.limitsFor(provider),
      requestsThisMinute: await this.store.get(this.rpmKey(provider, now)),
      tokensToday: await this.store.get(this.tpdKey(provider, now)),
      ...(cooldown && cooldown > now.getTime() ? { coolingDownUntil: new Date(cooldown).toISOString() } : {}),
    };
  }

  private rpmKey(provider: ProviderName, now: Date): string {
    return `llm:${provider}:rpm:${minuteKey(now)}`;
  }

  private tpdKey(provider: ProviderName, now: Date): string {
    return `llm:${provider}:tpd:${dayKey(now)}`;
  }

  private cooldownKey(provider: ProviderName): string {
    return `llm:${provider}:cooldown`;
  }
}
