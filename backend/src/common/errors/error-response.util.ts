import { AppError, ErrorDetails } from './app-errors';
import { ERROR_CODES } from './error-codes';

export interface ErrorResponseBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: ErrorDetails;
  };
}

export interface ErrorResponse {
  status: number;
  body: ErrorResponseBody;
}

interface HttpLikeError {
  statusCode?: number;
  status?: number;
  message?: string;
  code?: string;
  details?: ErrorDetails;
}

const STATUS_TO_CODE: Record<number, string> = {
  400: ERROR_CODES.VALIDATION_ERROR,
  401: ERROR_CODES.UNAUTHENTICATED,
  403: ERROR_CODES.FORBIDDEN,
  404: ERROR_CODES.NOT_FOUND,
  409: ERROR_CODES.CONFLICT,
  413: ERROR_CODES.VALIDATION_ERROR,
  415: ERROR_CODES.VALIDATION_ERROR,
  422: ERROR_CODES.VALIDATION_ERROR,
  429: ERROR_CODES.RATE_LIMITED,
};

/**
 * Converts any thrown value into the single error envelope the client sees.
 * AppErrors keep their code; framework HttpErrors (auth, body validation, unknown
 * route) are mapped by status; everything else becomes an opaque 500 so internal
 * messages never leak.
 */
export function toErrorResponse(error: unknown): ErrorResponse {
  if (error instanceof AppError) {
    const exposeMessage = error.statusCode < 500 || error.code !== ERROR_CODES.INTERNAL_ERROR;
    return {
      status: error.statusCode,
      body: {
        success: false,
        error: {
          code: error.code,
          message: exposeMessage ? error.message : 'Internal server error',
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      },
    };
  }

  const httpError = (typeof error === 'object' && error !== null ? error : {}) as HttpLikeError;
  const status = httpError.statusCode ?? httpError.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return {
      status,
      body: {
        success: false,
        error: {
          code: STATUS_TO_CODE[status] ?? ERROR_CODES.VALIDATION_ERROR,
          message: httpError.message ?? 'Request failed',
          ...(httpError.details !== undefined ? { details: httpError.details } : {}),
        },
      },
    };
  }

  return {
    status: 500,
    body: { success: false, error: { code: ERROR_CODES.INTERNAL_ERROR, message: 'Internal server error' } },
  };
}
