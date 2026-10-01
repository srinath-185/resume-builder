/** Every LLM call is tagged with the job it does; routing, budgets and usage logs key off this. */
export enum LlmTask {
  RESUME_PARSE = 'RESUME_PARSE',
  JD_KEYWORDS = 'JD_KEYWORDS',
  JOB_MATCH_SCORE = 'JOB_MATCH_SCORE',
  RESUME_TAILOR = 'RESUME_TAILOR',
  COVER_NOTE = 'COVER_NOTE',
  OUTREACH_DRAFT = 'OUTREACH_DRAFT',
}

/** Providers map a class to their own model id, so routing never names a vendor model. */
export type ModelClass = 'small' | 'large';

export type ProviderName = 'groq' | 'gemini' | 'opencode' | 'anthropic';

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  task: LlmTask;
  system?: string;
  messages: LlmMessage[];
  /** Ask the provider for a JSON object (json_object mode / responseMimeType). */
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  /** Attribution for usage logs and per-user caps. */
  userId?: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmCompletion {
  text: string;
  provider: ProviderName;
  model: string;
  usage: LlmUsage;
  latencyMs: number;
}

export interface ProviderCallOptions {
  model: string;
  maxTokens: number;
  temperature: number;
  json: boolean;
}

export interface ProviderResult {
  text: string;
  usage: LlmUsage;
}

export interface LlmProvider {
  readonly name: ProviderName;
  isConfigured(): boolean;
  modelFor(modelClass: ModelClass): string | undefined;
  complete(request: LlmRequest, options: ProviderCallOptions): Promise<ProviderResult>;
}

export interface TaskRoute {
  modelClass: ModelClass;
  maxTokens: number;
  temperature: number;
}

/** One failed or skipped provider in a routing attempt; returned in error details. */
export interface RouteAttempt {
  provider: ProviderName;
  outcome: 'skipped_unconfigured' | 'skipped_no_model' | 'skipped_budget' | 'rate_limited' | 'failed' | 'invalid_output';
  detail?: string;
}
