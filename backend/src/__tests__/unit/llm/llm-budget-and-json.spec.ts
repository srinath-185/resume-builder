import { expect } from '@loopback/testlab';
import { z } from 'zod';
import { MemoryBudgetStore } from '../../../services/llm/budget/budget-store';
import { LlmBudgetService } from '../../../services/llm/budget/llm-budget.service';
import { extractJson, LlmOutputError, parseJsonOutput } from '../../../services/llm/llm-json.util';
import { providerChainFor } from '../../../services/llm/llm-routes.config';
import { LlmTask } from '../../../services/llm/llm.types';

describe('LlmBudgetService', () => {
  let clock: Date;
  let budget: LlmBudgetService;

  beforeEach(() => {
    clock = new Date('2026-10-01T10:00:00Z');
    budget = new LlmBudgetService();
    budget.useStore(new MemoryBudgetStore(() => clock.getTime()), () => clock);
    process.env.GROQ_TOKENS_PER_DAY = '1000';
  });

  afterEach(() => {
    delete process.env.GROQ_TOKENS_PER_DAY;
  });

  it('refuses a call that would exceed the daily token budget', async () => {
    await budget.recordTokens('groq', 900);
    expect((await budget.canUse('groq', 50)).ok).to.be.true();
    const refused = await budget.canUse('groq', 200);
    expect(refused).to.eql({ ok: false, reason: 'daily token budget exhausted' });
  });

  it('resets the daily budget on the next UTC day', async () => {
    await budget.recordTokens('groq', 1000);
    clock = new Date('2026-10-02T00:00:01Z');
    expect((await budget.canUse('groq', 10)).ok).to.be.true();
  });

  it('honours a cool-down and lifts it afterwards', async () => {
    await budget.coolDown('groq', 30_000);
    expect((await budget.canUse('groq', 1)).ok).to.be.false();
    clock = new Date(clock.getTime() + 31_000);
    expect((await budget.canUse('groq', 1)).ok).to.be.true();
  });

  it('treats 0 as unlimited', async () => {
    await budget.recordTokens('anthropic', 10_000_000);
    expect((await budget.canUse('anthropic', 1_000_000)).ok).to.be.true();
  });

  it('reports status', async () => {
    await budget.recordRequest('groq');
    await budget.recordTokens('groq', 42);
    expect(await budget.status('groq')).to.containDeep({ provider: 'groq', requestsThisMinute: 1, tokensToday: 42, tokensPerDay: 1000 });
  });
});

describe('LLM JSON helpers', () => {
  it('extracts JSON from fences and surrounding prose', () => {
    expect(extractJson('Sure! ```json\n{"a":1}\n``` hope that helps')).to.equal('{"a":1}');
    expect(extractJson('Here you go: {"a":{"b":2}} done')).to.equal('{"a":{"b":2}}');
  });

  it('throws LlmOutputError on invalid JSON or schema mismatch', () => {
    expect(() => parseJsonOutput('nope', z.object({}))).to.throw(LlmOutputError);
    expect(() => parseJsonOutput('{"a":"x"}', z.object({ a: z.number() }))).to.throw(/a: /);
  });
});

describe('providerChainFor', () => {
  afterEach(() => {
    delete process.env.LLM_PROVIDER_CHAIN;
    delete process.env.LLM_ROUTE_RESUME_TAILOR;
  });

  it('defaults to free providers first', () => {
    expect(providerChainFor(LlmTask.RESUME_PARSE)).to.eql(['groq', 'gemini', 'opencode', 'anthropic']);
  });

  it('prefers the per-task override, then the global chain, ignoring unknown names', () => {
    process.env.LLM_PROVIDER_CHAIN = 'gemini, bogus, groq';
    process.env.LLM_ROUTE_RESUME_TAILOR = 'anthropic,groq';
    expect(providerChainFor(LlmTask.RESUME_PARSE)).to.eql(['gemini', 'groq']);
    expect(providerChainFor(LlmTask.RESUME_TAILOR)).to.eql(['anthropic', 'groq']);
  });
});
