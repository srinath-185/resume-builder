import { ResumeDocument } from './resume-document';

/** What a form field asks for, decided from its label/name/placeholder text. */
export type FieldKind =
  | 'firstName'
  | 'lastName'
  | 'fullName'
  | 'email'
  | 'phone'
  | 'linkedin'
  | 'github'
  | 'website'
  | 'location'
  | 'coverLetter'
  | 'resume'
  | 'question';

const RULES: Array<[FieldKind, RegExp]> = [
  ['resume', /\b(resume|cv|curriculum)\b/],
  ['coverLetter', /cover\s*letter|additional\s*information|message\s*to\s*(the\s*)?(hiring|recruit)/],
  ['firstName', /first\s*name|given\s*name|\bfname\b/],
  ['lastName', /last\s*name|surname|family\s*name|\blname\b/],
  ['fullName', /full\s*name|^\s*name\s*\*?\s*$|your\s*name|legal\s*name/],
  ['email', /e-?mail/],
  ['phone', /phone|mobile|\btel\b|contact\s*number/],
  ['linkedin', /linked\s*in/],
  ['github', /git\s*hub/],
  ['website', /website|portfolio|personal\s*(site|url)/],
  ['location', /^\s*(current\s*)?(location|city)\b/],
];

export function classifyField(label: string, inputType: string): FieldKind {
  const text = label.toLowerCase().replace(/[_-]+/g, ' ');
  if (inputType === 'file') return /cover/.test(text) ? 'question' : 'resume';
  if (inputType === 'email') return 'email';
  if (inputType === 'tel') return 'phone';
  for (const [kind, pattern] of RULES) {
    if (kind !== 'resume' && pattern.test(text)) return kind;
  }
  return 'question';
}

export interface ApplicantData {
  firstName: string;
  lastName: string;
  fullName: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  github?: string;
  website?: string;
  location?: string;
  coverLetter?: string;
  answers: Array<{ question: string; answer: string }>;
}

export function applicantFrom(document: ResumeDocument, coverNote: string | undefined, answers: Array<{ question: string; answer: string }>): ApplicantData {
  const parts = document.contact.name.trim().split(/\s+/);
  const link = (pattern: RegExp) => document.contact.links.find(url => pattern.test(url));
  return {
    firstName: parts[0] ?? '',
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : '',
    fullName: document.contact.name,
    email: document.contact.email,
    phone: document.contact.phone,
    linkedin: link(/linkedin\.com/i),
    github: link(/github\.com/i),
    website: document.contact.links.find(url => !/linkedin\.com|github\.com/i.test(url)),
    location: document.contact.location,
    coverLetter: coverNote,
    answers,
  };
}

const STOP = new Set(['the', 'a', 'an', 'you', 'your', 'do', 'have', 'are', 'is', 'of', 'to', 'for', 'in', 'with', 'what', 'how', 'why', 'please', 'this', 'our', 'we']);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9+#]+/)
      .filter(token => token.length > 1 && !STOP.has(token)),
  );
}

/** The approved answer whose question best matches a form label (token overlap ≥ 0.5), if any. */
export function matchAnswer(label: string, answers: ApplicantData['answers']): string | undefined {
  const labelTokens = tokens(label);
  if (labelTokens.size === 0) return undefined;
  let best: { score: number; answer: string } | undefined;
  for (const { question, answer } of answers) {
    const questionTokens = tokens(question);
    const overlap = [...labelTokens].filter(token => questionTokens.has(token)).length;
    const score = overlap / Math.max(labelTokens.size, questionTokens.size);
    if (score >= 0.5 && (!best || score > best.score)) best = { score, answer };
  }
  return best?.answer;
}

/** Value for a field, or undefined when nothing approved answers it (the agent then stops for review). */
export function valueFor(kind: FieldKind, label: string, data: ApplicantData): string | undefined {
  switch (kind) {
    case 'firstName':
      return data.firstName || undefined;
    case 'lastName':
      return data.lastName || undefined;
    case 'fullName':
      return data.fullName;
    case 'email':
      return data.email;
    case 'phone':
      return data.phone;
    case 'linkedin':
      return data.linkedin;
    case 'github':
      return data.github;
    case 'website':
      return data.website;
    case 'location':
      return data.location;
    case 'coverLetter':
      return data.coverLetter;
    case 'resume':
      return undefined;
    case 'question':
      return matchAnswer(label, data.answers);
  }
}

export type ApplyStrategyKind = 'ats-form' | 'linkedin-easy-apply' | 'manual';

const ATS_HOSTS = [/(^|\.)greenhouse\.io$/, /(^|\.)lever\.co$/, /(^|\.)ashbyhq\.com$/, /(^|\.)myworkdayjobs\.com$/, /(^|\.)smartrecruiters\.com$/, /(^|\.)workable\.com$/];

/**
 * Which automation (if any) handles a job URL. Only known applicant-tracking
 * systems and LinkedIn Easy Apply are automated; everything else, including
 * Naukri and Indeed, is left to the user with the approved PDF.
 */
export function chooseStrategy(url: string, extraFormHosts: string[] = []): ApplyStrategyKind {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return 'manual';
    host = parsed.hostname.toLowerCase();
  } catch {
    return 'manual';
  }
  if (/(^|\.)linkedin\.com$/.test(host) && /\/jobs\/view\//.test(url)) return 'linkedin-easy-apply';
  if (ATS_HOSTS.some(pattern => pattern.test(host)) || extraFormHosts.includes(host)) return 'ats-form';
  return 'manual';
}
