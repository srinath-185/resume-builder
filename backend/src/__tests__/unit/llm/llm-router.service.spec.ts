import { expect } from '@loopback/testlab';
import { z } from 'zod';
import { AppBusinessError, AppRateLimitError, UpstreamHttpError } from '../../../common/errors';
import { LlmUsageLog } from '../../../models';
import { LlmUsageLogRepository } from '../../../repositories';
import { LoggerService } from '../../../services/common/logger.service';
import { MemoryBudgetStore } from '../../../services/llm/budget/budget-store';
import { LlmBudgetService } from '../../../services/llm/budget/llm-budget.service';
import { LlmProviderRegistryService } from '../../../services/llm/llm-provider-registry.service';
import { LlmRouterService } from '../../../services/llm/llm-router.service';
import { LlmTask } from '../../../services/llm/llm.types';
import { FakeLlmProvider } from '../../helpers/fake-llm';

class FakeUsageRepo {
  rows: Partial<LlmUsageLog>[] = [];
  async create(row: Partial<LlmUsageLog>): Promise<Partial<LlmUsageLog>> {
    this.rows.push(row);
    return row;
  }
}

function givenRouter(...providers: FakeLlmProvider[]) {
  const registry = new LlmProviderRegistryService();
  registry.replace(providers);
  const budget = new LlmBudgetService();
  budget.useStore(new MemoryBudgetStore());
  const usage = new FakeUsageRepo();
  const router = new LlmRouterService(registry, budget, usage as unknown as LlmUsageLogRepository, new LoggerService());
  return { router, budget, usage };
}

const request = { task: LlmTask.JD_KEYWORDS, messages: [{ role: 'user' as const, content: 'hello' }], userId: 'u1' };
const Keywords = z.object({ keywords: z.array(z.string()) });

describe('LlmRouterService', () => {
  const savedChain = process.env.LLM_PROVIDER_CHAIN;
  afterEach(() => {
    if (savedChain === undefined) delete process.env.LLM_PROVIDER_CHAIN;
    else process.env.LLM_PROVIDER_CHAIN = savedChain;
    delete process.env.LLM_ROUTE_JD_KEYWORDS;
    delete process.env.GROQ_RPM;
  });

  it('uses the first configured provider and logs usage', async () => {
    const groq = new FakeLlmProvider('groq', ['hi']);
    const gemini = new FakeLlmProvider('gemini', ['unused']);
    const { router, usage } = givenRouter(groq, gemini);
    const completion = await router.complete(request);
    expect(completion).to.containDeep({ text: 'hi', provider: 'groq', model: 'groq-small' });
    expect(gemini.calls).to.have.length(0);
    expect(usage.rows[0]).to.containDeep({ userId: 'u1', task: 'JD_KEYWORDS', provider: 'groq', success: true, inputTokens: 100 });
  });

  it('applies the task route (model class, max tokens, temperature)', async () => {
    const groq = new FakeLlmProvider('groq', ['ok']);
    const { router } = givenRouter(groq);
    await router.complete({ ...request, task: LlmTask.RESUME_TAILOR });
    expect(groq.calls[0].options).to.containDeep({ model: 'groq-large', maxTokens: 4000, temperature: 0.2 });
  });

  it('skips unconfigured providers', async () => {
    const groq = new FakeLlmProvider('groq', ['x']);
    groq.configured = false;
    const gemini = new FakeLlmProvider('gemini', ['from gemini']);
    const { router } = givenRouter(groq, gemini);
    expect((await router.complete(request)).provider).to.equal('gemini');
  });

  it('falls back on 429 and cools the provider down', async () => {
    const groq = new FakeLlmProvider('groq', [new UpstreamHttpError('groq', 'limited', 429, undefined, 30_000)]);
    const gemini = new FakeLlmProvider('gemini', ['fallback']);
    const { router, budget } = givenRouter(groq, gemini);
    expect((await router.complete(request)).provider).to.equal('gemini');
    expect((await budget.status('groq')).coolingDownUntil).to.be.a.String();
    await router.complete(request);
    expect(groq.calls).to.have.length(1);
  });

  it('falls back on a server error', async () => {
    const groq = new FakeLlmProvider('groq', [new UpstreamHttpError('groq', 'down', 503)]);
    const gemini = new FakeLlmProvider('gemini', ['ok']);
    const { router, usage } = givenRouter(groq, gemini);
    await router.complete(request);
    expect(usage.rows.map(r => r.success)).to.eql([false, true]);
  });

  it('skips a provider whose per-minute budget is used up', async () => {
    process.env.GROQ_RPM = '1';
    const groq = new FakeLlmProvider('groq', ['first']);
    const gemini = new FakeLlmProvider('gemini', ['second']);
    const { router } = givenRouter(groq, gemini);
    expect((await router.complete(request)).provider).to.equal('groq');
    expect((await router.complete(request)).provider).to.equal('gemini');
  });

  it('validates JSON and falls through on invalid output', async () => {
    const groq = new FakeLlmProvider('groq', ['not json at all']);
    const gemini = new FakeLlmProvider('gemini', ['```json\n{"keywords":["node","react"]}\n```']);
    const { router } = givenRouter(groq, gemini);
    const { value, completion } = await router.completeJson(request, Keywords);
    expect(value.keywords).to.eql(['node', 'react']);
    expect(completion.provider).to.equal('gemini');
    expect(groq.calls[0].options.json).to.be.true();
    expect(groq.calls[0].request.system).to.match(/single JSON object/);
  });

  it('rejects JSON that does not match the schema', async () => {
    const groq = new FakeLlmProvider('groq', ['{"keywords": "not-an-array"}']);
    const { router } = givenRouter(groq);
    const error = await router.completeJson(request, Keywords).catch(e => e);
    expect(error).to.be.instanceOf(AppBusinessError);
    expect(error.code).to.equal('LLM_UNAVAILABLE');
    expect(error.details.attempts[0]).to.containDeep({ provider: 'groq', outcome: 'invalid_output' });
  });

  it('reports LLM_NOT_CONFIGURED when nothing is set up', async () => {
    const groq = new FakeLlmProvider('groq', ['x']);
    groq.configured = false;
    const { router } = givenRouter(groq);
    const error = await router.complete(request).catch(e => e);
    expect(error.code).to.equal('LLM_NOT_CONFIGURED');
  });

  it('reports LLM_BUDGET_EXHAUSTED when every provider is rate limited', async () => {
    const groq = new FakeLlmProvider('groq', [new UpstreamHttpError('groq', 'limited', 429)]);
    const { router } = givenRouter(groq);
    const error = await router.complete(request).catch(e => e);
    expect(error).to.be.instanceOf(AppRateLimitError);
    expect(error.code).to.equal('LLM_BUDGET_EXHAUSTED');
  });

  it('honours a per-task route override', async () => {
    process.env.LLM_ROUTE_JD_KEYWORDS = 'gemini,groq';
    const groq = new FakeLlmProvider('groq', ['g']);
    const gemini = new FakeLlmProvider('gemini', ['m']);
    const { router } = givenRouter(groq, gemini);
    expect((await router.complete(request)).provider).to.equal('gemini');
  });
});
