import { envInt, envString } from '../../../common/config/env.util';
import { ResilientHttpClient } from '../../../common/http/resilient-http.client';
import { LlmProvider, LlmRequest, ModelClass, ProviderCallOptions, ProviderResult } from '../llm.types';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

/** Google Gemini free tier, used as the first fallback. Model ids from GEMINI_SMALL_MODEL / GEMINI_LARGE_MODEL. */
export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini' as const;
  private readonly http: ResilientHttpClient;

  constructor(http?: ResilientHttpClient) {
    this.http = http ?? new ResilientHttpClient({ name: 'gemini', timeoutMs: envInt('LLM_TIMEOUT_MS', 60_000), retries: 1 });
  }

  isConfigured(): boolean {
    return envString('GEMINI_API_KEY') !== undefined;
  }

  modelFor(modelClass: ModelClass): string | undefined {
    return modelClass === 'small'
      ? envString('GEMINI_SMALL_MODEL', 'gemini-2.5-flash-lite')
      : envString('GEMINI_LARGE_MODEL', 'gemini-2.5-flash');
  }

  async complete(request: LlmRequest, options: ProviderCallOptions): Promise<ProviderResult> {
    const response = await this.http.request<GenerateContentResponse>({
      url: `${BASE_URL}/${encodeURIComponent(options.model)}:generateContent`,
      method: 'POST',
      headers: { 'x-goog-api-key': envString('GEMINI_API_KEY')! },
      body: {
        ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
        contents: request.messages.map(message => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        })),
        generationConfig: {
          temperature: options.temperature,
          maxOutputTokens: options.maxTokens,
          ...(options.json ? { responseMimeType: 'application/json' } : {}),
        },
      },
    });

    const parts = response.data?.candidates?.[0]?.content?.parts ?? [];
    return {
      text: parts.map(part => part.text ?? '').join(''),
      usage: {
        inputTokens: response.data?.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.data?.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }
}
