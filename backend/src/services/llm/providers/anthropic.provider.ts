import Anthropic from '@anthropic-ai/sdk';
import { envInt, envString } from '../../../common/config/env.util';
import { UpstreamHttpError } from '../../../common/errors';
import { LlmProvider, LlmRequest, ModelClass, ProviderCallOptions, ProviderResult } from '../llm.types';

const DEFAULT_MODEL = 'claude-opus-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/**
 * Optional paid provider, off until ANTHROPIC_API_KEY is set. Intended for the
 * quality-sensitive RESUME_TAILOR task via LLM_ROUTE_RESUME_TAILOR=anthropic,groq.
 *
 * Claude Opus 5.5 always thinks; depth is set with output_config.effort (default
 * "medium" there, set explicitly). Server-side `fallbacks: "default"` re-runs a
 * policy-declined request on Anthropic's recommended model instead of failing.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic' as const;
  private client?: Anthropic;

  isConfigured(): boolean {
    return envString('ANTHROPIC_API_KEY') !== undefined;
  }

  modelFor(_modelClass: ModelClass): string | undefined {
    return envString('ANTHROPIC_MODEL', DEFAULT_MODEL);
  }

  async complete(request: LlmRequest, options: ProviderCallOptions): Promise<ProviderResult> {
    const params = {
      model: options.model,
      // Thinking tokens count against max_tokens; leave headroom above the visible output.
      max_tokens: options.maxTokens + envInt('ANTHROPIC_THINKING_HEADROOM_TOKENS', 8000),
      ...(request.system ? { system: request.system } : {}),
      messages: request.messages.map(message => ({ role: message.role, content: message.content })),
      output_config: { effort: envString('ANTHROPIC_EFFORT', 'medium') },
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
    } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming;

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await this.sdk().beta.messages.create(params);
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new UpstreamHttpError('anthropic', error.message, error.status ?? undefined);
      }
      throw new UpstreamHttpError('anthropic', (error as Error).message);
    }

    // Check stop_reason before reading content: a refusal has no usable answer.
    if (message.stop_reason === 'refusal') {
      throw new UpstreamHttpError('anthropic', 'Request was declined by the model');
    }

    const text = message.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
      .map(block => block.text)
      .join('');
    return { text, usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens } };
  }

  private sdk(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({
        apiKey: envString('ANTHROPIC_API_KEY'),
        timeout: envInt('ANTHROPIC_TIMEOUT_MS', 300_000),
        maxRetries: 2,
      });
    }
    return this.client;
  }
}
