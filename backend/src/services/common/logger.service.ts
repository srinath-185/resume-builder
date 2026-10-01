import { BindingScope, injectable } from '@loopback/core';
import { redactSecrets } from '../../common/utils/redact.util';

type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * JSON-line logger. Context objects are redacted before they are written, so a
 * caller can pass a request or provider config without leaking credentials.
 */
@injectable({ scope: BindingScope.SINGLETON })
export class LoggerService {
  private threshold(): number {
    const configured = (process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'error' : 'info')) as Level;
    return LEVEL_ORDER[configured] ?? LEVEL_ORDER.info;
  }

  debug(message: string, context?: object): void {
    this.write('debug', message, context);
  }

  info(message: string, context?: object): void {
    this.write('info', message, context);
  }

  warn(message: string, context?: object): void {
    this.write('warn', message, context);
  }

  error(message: string, error?: unknown, context?: object): void {
    const errorInfo = error instanceof Error ? { error: error.message, stack: error.stack } : error !== undefined ? { error } : {};
    this.write('error', message, { ...errorInfo, ...context });
  }

  private write(level: Level, message: string, context?: object): void {
    if (LEVEL_ORDER[level] < this.threshold()) return;
    const line = JSON.stringify({ level, time: new Date().toISOString(), message, ...(context ? redactSecrets(context) : {}) });
    if (level === 'error' || level === 'warn') {
      console.error(line);
    } else {
      console.log(line);
    }
  }
}
