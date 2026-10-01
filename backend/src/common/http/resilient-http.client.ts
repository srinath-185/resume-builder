import CircuitBreaker from 'opossum';
import { UpstreamHttpError } from '../errors/app-errors';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface ResilientHttpOptions {
  /** Shown in errors and logs, e.g. "groq" or "jsearch". */
  name: string;
  timeoutMs?: number;
  /** Retries after the first attempt. */
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  breaker?: {
    errorThresholdPercentage?: number;
    resetTimeoutMs?: number;
    volumeThreshold?: number;
  };
  fetchImpl?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface HttpRequest {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  /** Objects are sent as JSON; strings are sent as-is. */
  body?: unknown;
}

export interface HttpResponse<T> {
  status: number;
  headers: Headers;
  data: T;
}

class AttemptError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }

  get retryable(): boolean {
    if (this.status === undefined) return true; // network error or timeout
    return this.status === 429 || (this.status >= 500 && this.status !== 501);
  }
}

const defaultSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

export function buildUrl(url: string, query?: HttpRequest['query']): string {
  if (!query) return url;
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) parsed.searchParams.set(key, String(value));
  }
  return parsed.toString();
}

/**
 * The only way this service talks to a third party. Every call gets a timeout,
 * exponential backoff with jitter on retryable failures (network, 429, 5xx;
 * Retry-After honoured), and a circuit breaker so a dead upstream fails fast
 * instead of tying up queue workers. Client errors (4xx other than 429) are not
 * retried and do not trip the breaker — they mean the request was wrong.
 */
export class ResilientHttpClient {
  private readonly breaker: CircuitBreaker<[HttpRequest], HttpResponse<unknown>>;
  private readonly fetchImpl: FetchFn;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(private readonly options: ResilientHttpOptions) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
    this.breaker = new CircuitBreaker((request: HttpRequest) => this.withRetry(request), {
      timeout: false,
      errorThresholdPercentage: options.breaker?.errorThresholdPercentage ?? 50,
      resetTimeout: options.breaker?.resetTimeoutMs ?? 30_000,
      volumeThreshold: options.breaker?.volumeThreshold ?? 5,
      errorFilter: (error: unknown) => error instanceof AttemptError && !error.retryable,
    });
  }

  get isOpen(): boolean {
    return this.breaker.opened;
  }

  async request<T>(request: HttpRequest): Promise<HttpResponse<T>> {
    try {
      return (await this.breaker.fire(request)) as HttpResponse<T>;
    } catch (error) {
      throw this.toUpstreamError(error);
    }
  }

  private async withRetry(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const retries = this.options.retries ?? 2;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.attempt(request);
      } catch (error) {
        const attemptError = error instanceof AttemptError ? error : new AttemptError(String(error));
        if (!attemptError.retryable || attempt >= retries) throw attemptError;
        await this.sleep(this.backoffMs(attempt, attemptError.retryAfterMs));
      }
    }
  }

  backoffMs(attempt: number, retryAfterMs?: number): number {
    const maxDelay = this.options.maxDelayMs ?? 10_000;
    if (retryAfterMs !== undefined) return Math.min(retryAfterMs, maxDelay * 3);
    const exponential = Math.min(maxDelay, (this.options.baseDelayMs ?? 500) * 2 ** attempt);
    return Math.round(exponential * (0.5 + this.random() * 0.5));
  }

  private async attempt(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 20_000);
    const isJsonBody = request.body !== undefined && typeof request.body !== 'string';
    try {
      const response = await this.fetchImpl(buildUrl(request.url, request.query), {
        method: request.method ?? (request.body === undefined ? 'GET' : 'POST'),
        headers: { ...(isJsonBody ? { 'content-type': 'application/json' } : {}), ...request.headers },
        body: request.body === undefined ? undefined : isJsonBody ? JSON.stringify(request.body) : (request.body as string),
        signal: controller.signal,
      });
      const text = await response.text();
      const data = parseBody(text, response.headers.get('content-type'));
      if (!response.ok) {
        throw new AttemptError(
          `${this.options.name} responded ${response.status}`,
          response.status,
          data,
          parseRetryAfter(response.headers.get('retry-after')),
        );
      }
      return { status: response.status, headers: response.headers, data };
    } catch (error) {
      if (error instanceof AttemptError) throw error;
      const reason = controller.signal.aborted ? 'timed out' : (error as Error).message;
      throw new AttemptError(`${this.options.name} request ${reason}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private toUpstreamError(error: unknown): UpstreamHttpError {
    if (error instanceof AttemptError) {
      return new UpstreamHttpError(this.options.name, error.message, error.status, error.body, error.retryAfterMs);
    }
    const code = (error as { code?: string }).code;
    if (code === 'EOPENBREAKER') {
      return new UpstreamHttpError(this.options.name, `${this.options.name} circuit is open`, undefined, undefined, undefined, true);
    }
    return new UpstreamHttpError(this.options.name, (error as Error).message ?? 'Upstream failure');
  }
}

function parseBody(text: string, contentType: string | null): unknown {
  if (text === '') return undefined;
  if (contentType?.includes('json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}
