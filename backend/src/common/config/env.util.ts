/**
 * Typed environment readers. Every value is read at call time, not module load,
 * so tests and `dotenv` ordering cannot freeze a stale value.
 */
export function envString(name: string, fallback?: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return raw.trim();
}

export function requiredEnv(name: string): string {
  const value = envString(name);
  if (value === undefined) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export function envInt(name: string, fallback: number): number {
  const raw = envString(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Only the literal string "false" disables a flag; anything else keeps the fallback. */
export function envBool(name: string, fallback: boolean): boolean {
  const raw = envString(name);
  if (raw === undefined) return fallback;
  if (raw.toLowerCase() === 'false') return false;
  if (raw.toLowerCase() === 'true') return true;
  return fallback;
}

export function envList(name: string, fallback: string[] = []): string[] {
  const raw = envString(name);
  if (raw === undefined) return fallback;
  return raw.split(',').map(item => item.trim()).filter(item => item.length > 0);
}

export function isTestEnv(): boolean {
  return process.env.NODE_ENV === 'test';
}
