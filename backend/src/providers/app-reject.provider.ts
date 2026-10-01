import { inject, Provider } from '@loopback/core';
import { HandlerContext, Reject } from '@loopback/rest';
import { toErrorResponse } from '../common/errors';
import { LoggerService } from '../services/common/logger.service';

/** Writes every failed request as `{ success: false, error: { code, message, details? } }`. */
export class AppRejectProvider implements Provider<Reject> {
  constructor(@inject('services.LoggerService') private logger: LoggerService) {}

  value(): Reject {
    return (context: HandlerContext, error: Error) => this.reject(context, error);
  }

  private reject({ request, response }: HandlerContext, error: Error): void {
    const { status, body } = toErrorResponse(error);
    if (status >= 500) {
      this.logger.error('Request failed', error, { method: request.method, url: request.originalUrl });
    }
    if (response.headersSent) return;
    response.status(status).json(body);
  }
}
