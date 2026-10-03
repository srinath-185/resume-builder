/** LinkedIn-style boolean query. {title} is required; any AND-clause using {location} is dropped when there is no location. */
export const DEFAULT_HIRING_QUERY_TEMPLATE = '"hiring" AND "{title}" AND "{location}"';

export const MAX_TEMPLATE_LENGTH = 300;

function sanitise(value: string | undefined): string {
  return (value ?? '').replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function validateHiringTemplate(template: string): string | undefined {
  if (!template.includes('{title}')) return 'The query template must contain {title}';
  if (template.length > MAX_TEMPLATE_LENGTH) return `The query template must be at most ${MAX_TEMPLATE_LENGTH} characters`;
  const unknown = [...template.matchAll(/\{(\w+)\}/g)].map(match => match[1]).filter(name => name !== 'title' && name !== 'location');
  return unknown.length ? `Unknown placeholder(s): ${unknown.map(name => `{${name}}`).join(', ')}` : undefined;
}

/**
 * buildHiringQuery('"hiring" AND "{title}" AND "{location}"', 'Backend Engineer', 'Chennai')
 *   → '"hiring" AND "Backend Engineer" AND "Chennai"'
 * buildHiringQuery(same, 'Backend Engineer', '')  → '"hiring" AND "Backend Engineer"'
 */
export function buildHiringQuery(template: string, title: string, location?: string | null): string {
  const cleanTitle = sanitise(title);
  const cleanLocation = sanitise(location ?? undefined);
  let query = template;
  if (!cleanLocation) {
    query = query
      .split(/\s+AND\s+/i)
      .filter(clause => !clause.includes('{location}'))
      .join(' AND ');
  }
  return query.replace(/\{title\}/g, cleanTitle).replace(/\{location\}/g, cleanLocation).replace(/\s+/g, ' ').trim();
}

/** Google treats AND as implicit; the literal word only adds noise. */
export function toGoogleQuery(booleanQuery: string): string {
  return booleanQuery.replace(/\s+AND\s+/g, ' ').trim();
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g;
const IGNORED_LOCAL_PARTS = /^(no-?reply|donotreply|mailer-daemon|privacy|abuse|support)$/i;
const IGNORED_DOMAINS = /(^|\.)(example\.(com|org|net)|sentry\.io|wixpress\.com)$/i;

/** Emails written in a post (often "send your CV to …"), minus obvious non-recruiter addresses. */
export function extractEmails(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(EMAIL)) {
    const email = match[0].replace(/\.+$/, '').toLowerCase();
    const [local, domain] = email.split('@');
    if (!IGNORED_LOCAL_PARTS.test(local) && !IGNORED_DOMAINS.test(domain)) found.add(email);
  }
  return [...found];
}

/** "Jane Doe on LinkedIn: We're hiring…" / "Jane Doe's Post - LinkedIn" → "Jane Doe". */
export function authorFromTitle(title: string | undefined): string | undefined {
  if (!title) return undefined;
  const match = /^(.+?)(?:\s+on LinkedIn\b|'s Post\b|\s+[-–|]\s+)/i.exec(title.trim());
  const name = (match ? match[1] : '').trim();
  return name && name.length <= 80 && !/linkedin/i.test(name) ? name : undefined;
}

/** Drops tracking query strings and trailing slashes so the same post dedupes. */
export function canonicalPostUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return url;
  }
}

/** How far back to look for posts. Values match the Apify posts actor's `postedLimit`. */
export const POSTED_WITHIN = ['1h', '24h', 'week', 'month', '3months', '6months', 'year', 'any'] as const;
export type PostedWithin = (typeof POSTED_WITHIN)[number];
export const DEFAULT_POSTED_WITHIN: PostedWithin = 'week';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const WINDOW_MS: Record<Exclude<PostedWithin, 'any'>, number> = {
  '1h': HOUR_MS,
  '24h': DAY_MS,
  week: 7 * DAY_MS,
  month: 30 * DAY_MS,
  '3months': 91 * DAY_MS,
  '6months': 182 * DAY_MS,
  year: 365 * DAY_MS,
};
const GOOGLE_TIME_RANGE: Record<Exclude<PostedWithin, 'any'>, string> = {
  '1h': 'qdr:h',
  '24h': 'qdr:d',
  week: 'qdr:w',
  month: 'qdr:m',
  '3months': 'qdr:m3',
  '6months': 'qdr:m6',
  year: 'qdr:y',
};

export function isPostedWithin(value: unknown): value is PostedWithin {
  return typeof value === 'string' && (POSTED_WITHIN as readonly string[]).includes(value);
}

/** Oldest post date the window allows; undefined for 'any'. */
export function postedSince(window: PostedWithin, now = Date.now()): Date | undefined {
  return window === 'any' ? undefined : new Date(now - WINDOW_MS[window]);
}

/** Google `tbs` value for the window; undefined for 'any' (no time filter). */
export function googleTimeRange(window: PostedWithin): string | undefined {
  return window === 'any' ? undefined : GOOGLE_TIME_RANGE[window];
}
