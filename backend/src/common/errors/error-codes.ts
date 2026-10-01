/**
 * Stable, client-facing error codes. The frontend maps each one to a translated
 * message (`frontend/src/common/locales/<lang>/errors.json`), so a code must never
 * be renamed once shipped — add a new one instead.
 */
export const ERROR_CODES = {
  // Generic
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMITED: 'RATE_LIMITED',
  UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',

  // Auth
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  PASSWORD_TOO_WEAK: 'PASSWORD_TOO_WEAK',
  TOKEN_INVALID: 'TOKEN_INVALID',

  // AI providers
  LLM_NOT_CONFIGURED: 'LLM_NOT_CONFIGURED',
  LLM_UNAVAILABLE: 'LLM_UNAVAILABLE',
  LLM_BUDGET_EXHAUSTED: 'LLM_BUDGET_EXHAUSTED',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
