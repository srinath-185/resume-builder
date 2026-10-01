import { Application } from '@loopback/core';
import { MemoryBudgetStore } from '../../services/llm/budget/budget-store';
import { LlmBudgetService } from '../../services/llm/budget/llm-budget.service';
import { LlmProviderRegistryService } from '../../services/llm/llm-provider-registry.service';
import { LlmProvider, LlmRequest, ModelClass, ProviderCallOptions, ProviderName, ProviderResult } from '../../services/llm/llm.types';

export type FakeReply = string | Error | ((request: LlmRequest) => string | Error);

/** Scripted provider: replies are consumed in order, the last one repeats. */
export class FakeLlmProvider implements LlmProvider {
  readonly calls: Array<{ request: LlmRequest; options: ProviderCallOptions }> = [];
  configured = true;

  constructor(
    readonly name: ProviderName,
    private replies: FakeReply[],
    private usage = { inputTokens: 100, outputTokens: 50 },
  ) {}

  isConfigured(): boolean {
    return this.configured;
  }

  modelFor(modelClass: ModelClass): string {
    return `${this.name}-${modelClass}`;
  }

  async complete(request: LlmRequest, options: ProviderCallOptions): Promise<ProviderResult> {
    this.calls.push({ request, options });
    const reply = this.replies[Math.min(this.calls.length - 1, this.replies.length - 1)];
    const value = typeof reply === 'function' ? reply(request) : reply;
    if (value instanceof Error) throw value;
    return { text: value, usage: this.usage };
  }

  script(replies: FakeReply[]): void {
    this.replies = replies;
    this.calls.length = 0;
  }
}

/** Replaces every real provider in a booted app with `providers` and resets budgets. */
export async function useFakeLlm(app: Application, ...providers: FakeLlmProvider[]): Promise<void> {
  const registry = await app.get<LlmProviderRegistryService>('services.LlmProviderRegistryService');
  registry.replace(providers);
  const budget = await app.get<LlmBudgetService>('services.LlmBudgetService');
  budget.useStore(new MemoryBudgetStore());
}
