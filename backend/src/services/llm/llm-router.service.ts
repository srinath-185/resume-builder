import { BindingScope, inject, injectable } from '@loopback/core';
import { z } from 'zod';
import { AppBusinessError, AppRateLimitError, ERROR_CODES, UpstreamHttpError } from '../../common/errors';
import { LlmUsageLogRepository } from '../../repositories';
import { LoggerService } from '../common/logger.service';
import { LlmBudgetService } from './budget/llm-budget.service';
import { estimateTokens, LlmOutputError, parseJsonOutput } from './llm-json.util';
import { LlmProviderRegistryService } from './llm-provider-registry.service';
import { providerChainFor, TASK_ROUTES } from './llm-routes.config';
import { LlmCompletion, LlmProvider, LlmRequest, RouteAttempt } from './llm.types';

const JSON_INSTRUCTION = 'Respond with a single JSON object only. No markdown, no commentary.';

/**
 * The only way the application calls a language model. For each request it
 * walks the task's provider chain (free tiers first) and, per provider:
 * skips it if unconfigured or over budget, calls it, records usage, and on a
 * 429 / failure / invalid output moves on to the next one. A caller sees
 * either a validated result or one error listing every attempt.
 */
@injectable({ scope: BindingScope.SINGLETON })
export class LlmRouterService {
  constructor(
    @inject('services.LlmProviderRegistryService') private registry: LlmProviderRegistryService,
    @inject('services.LlmBudgetService') private budget: LlmBudgetService,
    @inject('repositories.LlmUsageLogRepository') private usageLogs: LlmUsageLogRepository,
    @inject('services.LoggerService') private logger: LoggerService,
  ) {}

  /** Free-form text completion. */
  complete(request: LlmRequest): Promise<LlmCompletion> {
    return this.route(request, text => text);
  }

  /** JSON completion validated against `schema`; output that fails validation falls through to the next provider. */
  async completeJson<T>(request: LlmRequest, schema: z.ZodType<T>): Promise<{ value: T; completion: LlmCompletion }> {
    let value: T | undefined;
    const completion = await this.route({ ...request, json: true, system: withJsonInstruction(request.system) }, text => {
      value = parseJsonOutput(text, schema);
      return text;
    });
    return { value: value as T, completion };
  }

  private async route(request: LlmRequest, accept: (text: string) => string): Promise<LlmCompletion> {
    const route = TASK_ROUTES[request.task];
    const maxTokens = request.maxTokens ?? route.maxTokens;
    const temperature = request.temperature ?? route.temperature;
    const estimate = estimateTokens([request.system ?? '', ...request.messages.map(m => m.content)].join('\n')) + maxTokens;
    const attempts: RouteAttempt[] = [];

    for (const name of providerChainFor(request.task)) {
      const provider = this.registry.get(name);
      if (!provider || !provider.isConfigured()) {
        attempts.push({ provider: name, outcome: 'skipped_unconfigured' });
        continue;
      }
      const model = provider.modelFor(route.modelClass);
      if (!model) {
        attempts.push({ provider: name, outcome: 'skipped_no_model' });
        continue;
      }
      const allowance = await this.budget.canUse(name, estimate);
      if (!allowance.ok) {
        attempts.push({ provider: name, outcome: 'skipped_budget', detail: allowance.reason });
        continue;
      }

      const result = await this.attempt(provider, model, request, { maxTokens, temperature }, accept);
      if ('completion' in result) return result.completion;
      attempts.push(result.attempt);
    }

    throw this.exhausted(request, attempts);
  }

  private async attempt(
    provider: LlmProvider,
    model: string,
    request: LlmRequest,
    limits: { maxTokens: number; temperature: number },
    accept: (text: string) => string,
  ): Promise<{ completion: LlmCompletion } | { attempt: RouteAttempt }> {
    const started = Date.now();
    await this.budget.recordRequest(provider.name);
    try {
      const output = await provider.complete(request, { model, json: request.json ?? false, ...limits });
      const latencyMs = Date.now() - started;
      await this.budget.recordTokens(provider.name, output.usage.inputTokens + output.usage.outputTokens);
      try {
        accept(output.text);
      } catch (error) {
        await this.log(request, provider.name, model, output.usage, latencyMs, false, (error as Error).message);
        return { attempt: { provider: provider.name, outcome: 'invalid_output', detail: (error as Error).message } };
      }
      await this.log(request, provider.name, model, output.usage, latencyMs, true);
      return { completion: { text: output.text, provider: provider.name, model, usage: output.usage, latencyMs } };
    } catch (error) {
      const latencyMs = Date.now() - started;
      const zero = { inputTokens: 0, outputTokens: 0 };
      if (error instanceof UpstreamHttpError && error.isRateLimited) {
        await this.budget.coolDown(provider.name, error.retryAfterMs);
        await this.log(request, provider.name, model, zero, latencyMs, false, 'rate limited');
        return { attempt: { provider: provider.name, outcome: 'rate_limited' } };
      }
      const message = error instanceof LlmOutputError ? error.message : (error as Error).message;
      this.logger.warn('LLM provider failed, trying next', { provider: provider.name, task: request.task, error: message });
      await this.log(request, provider.name, model, zero, latencyMs, false, message);
      return { attempt: { provider: provider.name, outcome: 'failed', detail: message } };
    }
  }

  private exhausted(request: LlmRequest, attempts: RouteAttempt[]): Error {
    const details = { task: request.task, attempts };
    const everyoneOverBudget =
      attempts.length > 0 && attempts.every(a => a.outcome === 'skipped_budget' || a.outcome === 'rate_limited' || a.outcome === 'skipped_unconfigured');
    if (attempts.every(a => a.outcome === 'skipped_unconfigured' || a.outcome === 'skipped_no_model')) {
      return new AppBusinessError(ERROR_CODES.LLM_NOT_CONFIGURED, 'No AI provider is configured for this task', details);
    }
    if (everyoneOverBudget) {
      return new AppRateLimitError(ERROR_CODES.LLM_BUDGET_EXHAUSTED, 'Free AI quota is used up for now; try again later', details);
    }
    return new AppBusinessError(ERROR_CODES.LLM_UNAVAILABLE, 'No AI provider could complete the request', details);
  }

  private async log(
    request: LlmRequest,
    provider: string,
    model: string,
    usage: { inputTokens: number; outputTokens: number },
    latencyMs: number,
    success: boolean,
    error?: string,
  ): Promise<void> {
    try {
      await this.usageLogs.create({ userId: request.userId, task: request.task, provider, model, ...usage, latencyMs, success, error: error?.slice(0, 500) });
    } catch (logError) {
      this.logger.error('Failed to write LLM usage log', logError);
    }
  }
}

function withJsonInstruction(system?: string): string {
  return system ? `${system}\n\n${JSON_INSTRUCTION}` : JSON_INSTRUCTION;
}
