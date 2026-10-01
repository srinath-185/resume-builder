import { expect } from '@loopback/testlab';
import { ResilientHttpClient } from '../../../common/http/resilient-http.client';
import { LlmTask } from '../../../services/llm/llm.types';
import { AnthropicProvider } from '../../../services/llm/providers/anthropic.provider';
import { GeminiProvider } from '../../../services/llm/providers/gemini.provider';
import { createGroqProvider, createOpenCodeProvider } from '../../../services/llm/providers/openai-compatible.provider';

interface Captured {
  url: string;
  init: RequestInit;
}

function capturingHttp(name: string, body: unknown): { http: ResilientHttpClient; captured: Captured[] } {
  const captured: Captured[] = [];
  const http = new ResilientHttpClient({
    name,
    retries: 0,
    fetchImpl: async (url, init) => {
      captured.push({ url, init: init ?? {} });
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  return { http, captured };
}

const request = {
  task: LlmTask.JD_KEYWORDS,
  system: 'You extract keywords.',
  messages: [{ role: 'user' as const, content: 'Senior Node engineer' }],
};
const options = { model: 'm', maxTokens: 100, temperature: 0, json: true };

describe('LLM providers', () => {
  afterEach(() => {
    for (const key of ['GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENCODE_ZEN_API_KEY', 'OPENCODE_ZEN_LARGE_MODEL', 'OPENCODE_ZEN_JSON_MODE']) delete process.env[key];
  });

  it('Groq: sends an OpenAI-style request with json mode and bearer auth', async () => {
    process.env.GROQ_API_KEY = 'gsk_test';
    const { http, captured } = capturingHttp('groq', {
      choices: [{ message: { content: '{"keywords":[]}' } }],
      usage: { prompt_tokens: 12, completion_tokens: 3 },
    });
    const provider = createGroqProvider(http);
    const result = await provider.complete(request, options);

    expect(captured[0].url).to.equal('https://api.groq.com/openai/v1/chat/completions');
    expect((captured[0].init.headers as Record<string, string>).authorization).to.equal('Bearer gsk_test');
    const body = JSON.parse(String(captured[0].init.body));
    expect(body.messages[0]).to.eql({ role: 'system', content: 'You extract keywords.' });
    expect(body.response_format).to.eql({ type: 'json_object' });
    expect(result).to.eql({ text: '{"keywords":[]}', usage: { inputTokens: 12, outputTokens: 3 } });
    expect(provider.modelFor('large')).to.equal('llama-3.3-70b-versatile');
  });

  it('OpenCode Zen: unconfigured without a key, no default model, no json mode unless enabled', async () => {
    const { http, captured } = capturingHttp('opencode', { choices: [{ message: { content: 'x' } }] });
    const provider = createOpenCodeProvider(http);
    expect(provider.isConfigured()).to.be.false();
    expect(provider.modelFor('large')).to.be.undefined();

    process.env.OPENCODE_ZEN_API_KEY = 'zen';
    process.env.OPENCODE_ZEN_LARGE_MODEL = 'some-free-model';
    await provider.complete(request, options);
    expect(captured[0].url).to.equal('https://opencode.ai/zen/v1/chat/completions');
    expect(JSON.parse(String(captured[0].init.body))).to.not.have.property('response_format');

    process.env.OPENCODE_ZEN_JSON_MODE = 'true';
    await provider.complete(request, options);
    expect(JSON.parse(String(captured[1].init.body)).response_format).to.eql({ type: 'json_object' });
  });

  it('Anthropic: off until a key is set, defaults to Claude Opus 5.5', () => {
    delete process.env.ANTHROPIC_API_KEY;
    const provider = new AnthropicProvider();
    expect(provider.isConfigured()).to.be.false();
    expect(provider.modelFor('large')).to.equal('claude-opus-5-5');
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(provider.isConfigured()).to.be.true();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('Gemini: maps roles, system instruction and JSON mime type', async () => {
    process.env.GEMINI_API_KEY = 'g-key';
    const { http, captured } = capturingHttp('gemini', {
      candidates: [{ content: { parts: [{ text: '{"a":' }, { text: '1}' }] } }],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 4 },
    });
    const provider = new GeminiProvider(http);
    const result = await provider.complete(
      { ...request, messages: [...request.messages, { role: 'assistant', content: 'ok' }] },
      { ...options, model: 'gemini-x' },
    );

    expect(captured[0].url).to.equal('https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent');
    expect((captured[0].init.headers as Record<string, string>)['x-goog-api-key']).to.equal('g-key');
    const body = JSON.parse(String(captured[0].init.body));
    expect(body.systemInstruction.parts[0].text).to.equal('You extract keywords.');
    expect(body.contents.map((c: { role: string }) => c.role)).to.eql(['user', 'model']);
    expect(body.generationConfig).to.eql({ temperature: 0, maxOutputTokens: 100, responseMimeType: 'application/json' });
    expect(result).to.eql({ text: '{"a":1}', usage: { inputTokens: 20, outputTokens: 4 } });
  });
});
