import { BindingScope, inject, injectable } from '@loopback/core';
import { LlmUsageLogRepository } from '../../repositories';
import { LlmBudgetService, ProviderBudgetStatus } from './budget/llm-budget.service';
import { LlmProviderRegistryService } from './llm-provider-registry.service';
import { providerChainFor } from './llm-routes.config';
import { LlmTask, ProviderName } from './llm.types';

export interface ProviderStatus extends ProviderBudgetStatus {
  configured: boolean;
  models: { small?: string; large?: string };
}

export interface UsageRow {
  provider: string;
  task: string;
  calls: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmStatus {
  providers: ProviderStatus[];
  routes: Record<LlmTask, ProviderName[]>;
  usageToday: UsageRow[];
}

@injectable({ scope: BindingScope.TRANSIENT })
export class LlmStatusService {
  constructor(
    @inject('services.LlmProviderRegistryService') private registry: LlmProviderRegistryService,
    @inject('services.LlmBudgetService') private budget: LlmBudgetService,
    @inject('repositories.LlmUsageLogRepository') private usageLogs: LlmUsageLogRepository,
  ) {}

  async status(userId: string): Promise<LlmStatus> {
    const providers = await Promise.all(
      this.registry.all().map(async provider => ({
        ...(await this.budget.status(provider.name)),
        configured: provider.isConfigured(),
        models: { small: provider.modelFor('small'), large: provider.modelFor('large') },
      })),
    );
    const routes = Object.fromEntries(Object.values(LlmTask).map(task => [task, providerChainFor(task)])) as Record<LlmTask, ProviderName[]>;
    return { providers, routes, usageToday: await this.usageToday(userId) };
  }

  private async usageToday(userId: string): Promise<UsageRow[]> {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const logs = await this.usageLogs.find({ where: { userId, createdAt: { gte: since } } });
    const rows = new Map<string, UsageRow>();
    for (const log of logs) {
      const key = `${log.provider}:${log.task}`;
      const row = rows.get(key) ?? { provider: log.provider, task: log.task, calls: 0, failures: 0, inputTokens: 0, outputTokens: 0 };
      row.calls++;
      if (!log.success) row.failures++;
      row.inputTokens += log.inputTokens ?? 0;
      row.outputTokens += log.outputTokens ?? 0;
      rows.set(key, row);
    }
    return [...rows.values()];
  }
}
