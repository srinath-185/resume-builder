import { createHash } from 'crypto';

export interface NormalisedJob {
  source: string;
  externalId: string;
  title: string;
  company: string;
  location?: string;
  remote?: boolean;
  url: string;
  applyUrl?: string;
  description: string;
  postedAt?: Date;
  employmentType?: string;
  salary?: string;
  applyOptions?: Array<{ publisher: string; url: string; isDirect?: boolean }>;
}

export interface JobSearchQuery {
  title: string;
  location?: string;
  remoteOnly: boolean;
  limit: number;
}

const COMPANY_SUFFIXES = /\b(inc|incorporated|llc|ltd|limited|pvt|private|plc|gmbh|corp|corporation|co|company|technologies|technology|solutions|labs)\b\.?/g;

/**
 * Turns a resume heading such as "Backend Developer — GoldArk (Gold Savings App)"
 * into a job-board query ("Backend Developer"): drops anything after a
 * dash, pipe, "@" or " at ", and any bracketed text.
 */
export function searchTitle(title: string): string {
  const head = title.split(/\s+[—–|@-]\s+|\s+at\s+|,\s+/i)[0];
  return head.replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normaliseCompany(company: string): string {
  return company.toLowerCase().replace(/[.,()]/g, ' ').replace(COMPANY_SUFFIXES, ' ').replace(/\s+/g, ' ').trim();
}

export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/[^a-z0-9+#.\s/-]/g, ' ')
    .replace(/\b(sr)\b\.?/g, 'senior')
    .replace(/\b(jr)\b\.?/g, 'junior')
    .replace(/\s+/g, ' ')
    .trim();
}

/** City-level location, so "Bengaluru, Karnataka, India" and "Bengaluru" collide. */
export function normaliseLocation(location?: string): string {
  if (!location) return '';
  const first = location.split(/[,|/]/)[0] ?? '';
  return first.toLowerCase().replace(/\bbangalore\b/, 'bengaluru').replace(/\s+/g, ' ').trim();
}

/** Same role at the same company in the same city is one job, whichever portal listed it. */
export function jobFingerprint(job: Pick<NormalisedJob, 'company' | 'title' | 'location'>): string {
  const key = [normaliseCompany(job.company), normaliseTitle(job.title), normaliseLocation(job.location)].join('|');
  return createHash('sha1').update(key).digest('hex');
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

export function stripHtml(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z#0-9]+;/gi, entity => ENTITIES[entity.toLowerCase()] ?? ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/** Accepts only http(s) URLs from third-party payloads. */
export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function toDate(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const date = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

const MAX_DESCRIPTION = 12_000;

export function clipDescription(text: string): string {
  return text.length > MAX_DESCRIPTION ? text.slice(0, MAX_DESCRIPTION) : text;
}
