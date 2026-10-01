import { z } from 'zod';

/** Strips markdown fences and leading prose some free models add around JSON. */
export function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.search(/[[{]/);
  if (start < 0) return candidate;
  const open = candidate[start];
  const close = open === '{' ? '}' : ']';
  const end = candidate.lastIndexOf(close);
  return end > start ? candidate.slice(start, end + 1) : candidate.slice(start);
}

export class LlmOutputError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
  }
}

export function parseJsonOutput<T>(text: string, schema: z.ZodType<T>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    throw new LlmOutputError('Model output is not valid JSON', text);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.slice(0, 5).map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
    throw new LlmOutputError(`Model output failed validation: ${issues.join('; ')}`, text);
  }
  return result.data;
}

/** Rough token estimate (~4 chars/token) used only for pre-call budget checks. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
