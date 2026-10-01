import { envInt, envString } from '../../../common/config/env.util';
import { ResilientHttpClient } from '../../../common/http/resilient-http.client';
import { LlmProvider, LlmRequest, ModelClass, ProviderCallOptions, ProviderName, ProviderResult } from '../llm.types';

export interface OpenAiCompatibleConfig {
  name: Extract<ProviderName, 'groq' | 'opencode'>;
  /** Env var names, read at call time. */
  apiKeyEnv: string;
  baseUrlEnv: string;
  defaultBaseUrl: string;
  smallModelEnv: string;
  largeModelEnv: string;
  defaultSmallModel?: string;
  defaultLargeModel?: string;
  /** Not every OpenAI-compatible endpoint accepts response_format; others get a prompt instruction only. */
  supportsJsonModeEnv?: string;
  defaultSupportsJsonMode: boolean;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Groq and OpenCode Zen both speak the OpenAI chat-completions protocol, so one
 * class serves both, parameterised by env var names. Model ids live in env
 * because free model line-ups rotate (OpenCode's free models change weekly).
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name: Extract<ProviderName, 'groq' | 'opencode'>;
  private readonly http: ResilientHttpClient;

  constructor(
    private readonly config: OpenAiCompatibleConfig,
    http?: ResilientHttpClient,
  ) {
    this.name = config.name;
    this.http =
      http ??
      new ResilientHttpClient({
        name: config.name,
        timeoutMs: envInt('LLM_TIMEOUT_MS', 60_000),
        // The router falls back to the next provider; long retries here would just delay that.
        retries: 1,
      });
  }

  isConfigured(): boolean {
    return envString(this.config.apiKeyEnv) !== undefined;
  }

  modelFor(modelClass: ModelClass): string | undefined {
    return modelClass === 'small'
      ? envString(this.config.smallModelEnv, this.config.defaultSmallModel)
      : envString(this.config.largeModelEnv, this.config.defaultLargeModel);
  }

  async complete(request: LlmRequest, options: ProviderCallOptions): Promise<ProviderResult> {
    const supportsJsonMode = this.config.supportsJsonModeEnv
      ? envString(this.config.supportsJsonModeEnv, String(this.config.defaultSupportsJsonMode)) === 'true'
      : this.config.defaultSupportsJsonMode;
    const messages = [
      ...(request.system ? [{ role: 'system', content: request.system }] : []),
      ...request.messages.map(message => ({ role: message.role, content: message.content })),
    ];
    const baseUrl = envString(this.config.baseUrlEnv, this.config.defaultBaseUrl)!.replace(/\/+$/, '');

    const response = await this.http.request<ChatCompletionResponse>({
      url: `${baseUrl}/chat/completions`,
      method: 'POST',
      headers: { authorization: `Bearer ${envString(this.config.apiKeyEnv)}` },
      body: {
        model: options.model,
        messages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        ...(options.json && supportsJsonMode ? { response_format: { type: 'json_object' } } : {}),
      },
    });

    const text = response.data?.choices?.[0]?.message?.content ?? '';
    return {
      text,
      usage: {
        inputTokens: response.data?.usage?.prompt_tokens ?? 0,
        outputTokens: response.data?.usage?.completion_tokens ?? 0,
      },
    };
  }
}

/**
 * Groq free tier: ~30 RPM and per-model daily token caps, org-wide. Defaults are
 * production text models; override with GROQ_SMALL_MODEL / GROQ_LARGE_MODEL.
 */
export function createGroqProvider(http?: ResilientHttpClient): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider(
    {
      name: 'groq',
      apiKeyEnv: 'GROQ_API_KEY',
      baseUrlEnv: 'GROQ_BASE_URL',
      defaultBaseUrl: 'https://api.groq.com/openai/v1',
      smallModelEnv: 'GROQ_SMALL_MODEL',
      largeModelEnv: 'GROQ_LARGE_MODEL',
      defaultSmallModel: 'llama-3.1-8b-instant',
      defaultLargeModel: 'llama-3.3-70b-versatile',
      defaultSupportsJsonMode: true,
    },
    http,
  );
}

/**
 * OpenCode Zen: OpenAI-compatible gateway whose free models rotate (e.g. the
 * "space-bunny-free" preview ended 2026-09-30). No default model on purpose —
 * set OPENCODE_ZEN_SMALL_MODEL / OPENCODE_ZEN_LARGE_MODEL to whatever is free now.
 */
export function createOpenCodeProvider(http?: ResilientHttpClient): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider(
    {
      name: 'opencode',
      apiKeyEnv: 'OPENCODE_ZEN_API_KEY',
      baseUrlEnv: 'OPENCODE_ZEN_BASE_URL',
      defaultBaseUrl: 'https://opencode.ai/zen/v1',
      smallModelEnv: 'OPENCODE_ZEN_SMALL_MODEL',
      largeModelEnv: 'OPENCODE_ZEN_LARGE_MODEL',
      supportsJsonModeEnv: 'OPENCODE_ZEN_JSON_MODE',
      defaultSupportsJsonMode: false,
    },
    http,
  );
}
