import { BindingScope, injectable } from '@loopback/core';
import { LlmProvider, ProviderName } from './llm.types';
import { AnthropicProvider } from './providers/anthropic.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { createGroqProvider, createOpenCodeProvider } from './providers/openai-compatible.provider';

/** Holds one instance per provider so each keeps its own circuit breaker across calls. */
@injectable({ scope: BindingScope.SINGLETON })
export class LlmProviderRegistryService {
  private providers = new Map<ProviderName, LlmProvider>([
    ['groq', createGroqProvider()],
    ['gemini', new GeminiProvider()],
    ['opencode', createOpenCodeProvider()],
    ['anthropic', new AnthropicProvider()],
  ]);

  get(name: ProviderName): LlmProvider | undefined {
    return this.providers.get(name);
  }

  all(): LlmProvider[] {
    return [...this.providers.values()];
  }

  /** Test seam: swap in fakes. */
  replace(providers: LlmProvider[]): void {
    this.providers = new Map(providers.map(provider => [provider.name, provider]));
  }
}
