import { ERROR_CODES } from './error-codes';

export type ErrorDetails = Record<string, unknown> | unknown[];

/**
 * Base for every error this API throws on purpose. Anything that is not an
 * AppError reaching the reject provider is treated as an unexpected 500.
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: ErrorDetails,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class AppValidationError extends AppError {
  constructor(code: string = ERROR_CODES.VALIDATION_ERROR, message = 'Validation failed', details?: ErrorDetails) {
    super(422, code, message, details);
  }
}

export class AppAuthenticationError extends AppError {
  constructor(code: string = ERROR_CODES.UNAUTHENTICATED, message = 'Authentication required') {
    super(401, code, message);
  }
}

export class AppAuthorizationError extends AppError {
  constructor(code: string = ERROR_CODES.FORBIDDEN, message = 'Not allowed') {
    super(403, code, message);
  }
}

export class AppNotFoundError extends AppError {
  constructor(code: string = ERROR_CODES.NOT_FOUND, message = 'Not found') {
    super(404, code, message);
  }
}

export class AppConflictError extends AppError {
  constructor(code: string = ERROR_CODES.CONFLICT, message = 'Conflict', details?: ErrorDetails) {
    super(409, code, message, details);
  }
}

/** A business rule refused the request (state machine, caps, missing prerequisite). */
export class AppBusinessError extends AppError {
  constructor(code: string, message: string, details?: ErrorDetails) {
    super(400, code, message, details);
  }
}

export class AppRateLimitError extends AppError {
  constructor(code: string = ERROR_CODES.RATE_LIMITED, message = 'Too many requests', details?: ErrorDetails) {
    super(429, code, message, details);
  }
}

export class AppConfigurationError extends AppError {
  constructor(message: string) {
    super(500, ERROR_CODES.CONFIGURATION_ERROR, message);
  }
}

/**
 * A third-party call failed after retries, or its circuit is open. Carries the
 * upstream status so callers (e.g. the LLM router) can decide whether to fall
 * back to another provider.
 */
export class UpstreamHttpError extends AppError {
  constructor(
    readonly service: string,
    message: string,
    readonly upstreamStatus?: number,
    readonly upstreamBody?: unknown,
    readonly retryAfterMs?: number,
    readonly breakerOpen = false,
  ) {
    super(502, ERROR_CODES.UPSTREAM_UNAVAILABLE, message, { service, upstreamStatus });
  }

  get isRateLimited(): boolean {
    return this.upstreamStatus === 429;
  }

  /** 4xx other than 429 means the request itself was wrong — retrying elsewhere won't fix a bad key or payload. */
  get isClientError(): boolean {
    return this.upstreamStatus !== undefined && this.upstreamStatus >= 400 && this.upstreamStatus < 500 && this.upstreamStatus !== 429;
  }
}
