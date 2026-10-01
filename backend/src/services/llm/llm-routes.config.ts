import { envList } from '../../common/config/env.util';
import { LlmTask, ProviderName, TaskRoute } from './llm.types';

/**
 * Per-task defaults. Small models carry the high-volume, low-judgement work;
 * the large class is reserved for parsing and tailoring, where output quality
 * matters and free daily token caps are tightest.
 */
export const TASK_ROUTES: Record<LlmTask, TaskRoute> = {
  [LlmTask.RESUME_PARSE]: { modelClass: 'large', maxTokens: 3000, temperature: 0 },
  [LlmTask.JD_KEYWORDS]: { modelClass: 'small', maxTokens: 600, temperature: 0 },
  [LlmTask.JOB_MATCH_SCORE]: { modelClass: 'small', maxTokens: 800, temperature: 0 },
  [LlmTask.RESUME_TAILOR]: { modelClass: 'large', maxTokens: 4000, temperature: 0.2 },
  [LlmTask.COVER_NOTE]: { modelClass: 'small', maxTokens: 600, temperature: 0.4 },
  [LlmTask.OUTREACH_DRAFT]: { modelClass: 'small', maxTokens: 600, temperature: 0.4 },
};

const KNOWN_PROVIDERS: ProviderName[] = ['groq', 'gemini', 'opencode', 'anthropic'];
const DEFAULT_CHAIN: ProviderName[] = ['groq', 'gemini', 'opencode', 'anthropic'];

function onlyKnown(names: string[]): ProviderName[] {
  return names.filter((name): name is ProviderName => (KNOWN_PROVIDERS as string[]).includes(name));
}

/**
 * Provider order for a task. `LLM_ROUTE_<TASK>` (e.g. LLM_ROUTE_RESUME_TAILOR=anthropic,groq)
 * overrides `LLM_PROVIDER_CHAIN`, which overrides the free-first default. Unconfigured
 * providers are skipped at call time, so listing a paid one costs nothing until its key is set.
 */
export function providerChainFor(task: LlmTask): ProviderName[] {
  const perTask = onlyKnown(envList(`LLM_ROUTE_${task}`));
  if (perTask.length > 0) return perTask;
  const global = onlyKnown(envList('LLM_PROVIDER_CHAIN'));
  return global.length > 0 ? global : DEFAULT_CHAIN;
}
