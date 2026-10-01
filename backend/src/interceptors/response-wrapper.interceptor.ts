import { globalInterceptor, Interceptor, InvocationContext, InvocationResult, Provider, ValueOrPromise } from '@loopback/core';
import { Readable } from 'stream';

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
}

/** Binary bodies and streams are written as-is; everything else gets the success envelope. */
export function shouldWrap(result: unknown): boolean {
  if (result === undefined || result === null) return false;
  if (Buffer.isBuffer(result) || result instanceof Readable) return false;
  return !(typeof result === 'object' && 'success' in (result as object) && 'data' in (result as object));
}

@globalInterceptor('response', { tags: { name: 'responseWrapper' } })
export class ResponseWrapperInterceptor implements Provider<Interceptor> {
  value(): Interceptor {
    return this.intercept.bind(this);
  }

  async intercept(_context: InvocationContext, next: () => ValueOrPromise<InvocationResult>): Promise<InvocationResult> {
    const result = await next();
    return shouldWrap(result) ? ({ success: true, data: result } satisfies SuccessEnvelope<unknown>) : result;
  }
}
