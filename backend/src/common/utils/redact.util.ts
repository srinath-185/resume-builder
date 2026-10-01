const SECRET_KEY_PATTERN = /pass(word)?|secret|token|api[-_]?key|cookie|authorization|credential/i;
const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;

/**
 * Deep-copies a value with every secret-looking key replaced. Used before
 * anything is written to audit rows or logs, so a token can never be read back
 * from either.
 */
export function redactSecrets<T>(value: T, depth = 0): T {
  if (depth > MAX_DEPTH || value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map(item => redactSecrets(item, depth + 1)) as unknown as T;
  }
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redactSecrets(item, depth + 1);
    }
    return output as T;
  }
  return value;
}
