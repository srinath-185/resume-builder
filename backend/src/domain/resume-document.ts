import { z } from 'zod';

/**
 * The structured resume every feature works on: parsed from the upload,
 * corrected by the user, then copied and rephrased (never extended) per job.
 * Dates are free strings ("2021-03", "2019", "Present") because resumes are
 * inconsistent and the fact-checker compares them literally.
 */
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullish().transform(value => value || undefined);
const list = <T extends z.ZodTypeAny>(item: T, max: number) => z.array(item).max(max).nullish().transform(value => value ?? []);

export const ContactSchema = z.object({
  name: text(120),
  email: optionalText(254),
  phone: optionalText(40),
  location: optionalText(120),
  links: list(text(300), 10),
});

export const ExperienceSchema = z.object({
  company: text(160),
  title: text(160),
  location: optionalText(120),
  startDate: optionalText(20),
  endDate: optionalText(20),
  bullets: list(text(600), 30),
});

export const EducationSchema = z.object({
  institution: text(200),
  degree: optionalText(160),
  field: optionalText(160),
  startDate: optionalText(20),
  endDate: optionalText(20),
});

export const ProjectSchema = z.object({
  name: text(160),
  description: optionalText(600),
  bullets: list(text(600), 15),
});

export const CertificationSchema = z.object({
  name: text(200),
  issuer: optionalText(160),
  date: optionalText(20),
});

const MAX_SKILLS = 150;
const CATEGORY_LABEL = /^[^:,;()]{1,40}:\s*/;

/** Splits on commas and semicolons that are not inside brackets, so "JavaScript (ES6+, ESNext)" stays whole. */
function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value) {
    if ('([{'.includes(char)) depth++;
    else if (')]}'.includes(char)) depth = Math.max(0, depth - 1);
    if (depth === 0 && (char === ',' || char === ';')) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

/**
 * Resumes often group skills as "Frontend: React, Vue, Vite" and models copy
 * each line as one entry. Turn those into one skill per item: drop the
 * category label, split the list, and remove case-insensitive duplicates.
 */
export function normalizeSkills(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const seen = new Set<string>();
  const skills: unknown[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      skills.push(item);
      continue;
    }
    const parts = splitTopLevel(item);
    const grouped = parts.length > 1 || CATEGORY_LABEL.test(item);
    const pieces = grouped ? splitTopLevel(item.replace(CATEGORY_LABEL, '')) : parts;
    for (const piece of pieces) {
      const skill = piece.replace(/\s+/g, ' ').trim();
      const key = skill.toLowerCase();
      if (!skill || seen.has(key)) continue;
      seen.add(key);
      skills.push(skill);
    }
  }
  return skills.slice(0, MAX_SKILLS);
}

export const ResumeDocumentSchema = z.object({
  contact: ContactSchema,
  headline: optionalText(200),
  summary: optionalText(2000),
  experience: list(ExperienceSchema, 30),
  education: list(EducationSchema, 15),
  skills: z.preprocess(normalizeSkills, list(text(80), MAX_SKILLS)),
  projects: list(ProjectSchema, 20),
  certifications: list(CertificationSchema, 30),
});

export type ResumeDocument = z.infer<typeof ResumeDocumentSchema>;
export type ResumeExperience = z.infer<typeof ExperienceSchema>;

const PRESENT = /^(present|current|now|till date|to date|ongoing)$/i;

/** "2021-03" → months since epoch-ish; "Present" → now; anything unparseable → undefined. */
export function toMonthIndex(value: string | undefined, now = new Date()): number | undefined {
  if (!value) return undefined;
  if (PRESENT.test(value.trim())) return now.getUTCFullYear() * 12 + now.getUTCMonth();
  const match = /^(\d{4})(?:[-/.](\d{1,2}))?/.exec(value.trim());
  if (!match) return undefined;
  const month = match[2] ? Math.min(12, Math.max(1, Number(match[2]))) - 1 : 0;
  return Number(match[1]) * 12 + month;
}

/** Total experience in whole years, merging overlapping roles so concurrent jobs are not double-counted. */
export function yearsOfExperience(document: ResumeDocument, now = new Date()): number {
  const ranges = document.experience
    .map(role => [toMonthIndex(role.startDate, now), toMonthIndex(role.endDate ?? 'Present', now)] as const)
    .filter((range): range is readonly [number, number] => range[0] !== undefined && range[1] !== undefined && range[1] >= range[0])
    .sort((a, b) => a[0] - b[0]);

  let months = 0;
  let current: [number, number] | undefined;
  for (const [start, end] of ranges) {
    if (current && start <= current[1]) {
      current[1] = Math.max(current[1], end);
    } else {
      if (current) months += current[1] - current[0];
      current = [start, end];
    }
  }
  if (current) months += current[1] - current[0];
  return Math.floor(months / 12);
}

/** Plain-text rendering used as LLM input for later steps (matching, tailoring). */
export function resumeToText(document: ResumeDocument): string {
  const lines: string[] = [document.contact.name];
  if (document.headline) lines.push(document.headline);
  if (document.summary) lines.push('', 'SUMMARY', document.summary);
  if (document.experience.length) {
    lines.push('', 'EXPERIENCE');
    for (const role of document.experience) {
      lines.push(`${role.title} — ${role.company} (${role.startDate ?? '?'} – ${role.endDate ?? 'Present'})`);
      lines.push(...role.bullets.map(bullet => `- ${bullet}`));
    }
  }
  if (document.skills.length) lines.push('', 'SKILLS', document.skills.join(', '));
  if (document.projects.length) {
    lines.push('', 'PROJECTS');
    for (const project of document.projects) {
      lines.push(project.name + (project.description ? `: ${project.description}` : ''));
      lines.push(...project.bullets.map(bullet => `- ${bullet}`));
    }
  }
  if (document.education.length) {
    lines.push('', 'EDUCATION');
    lines.push(...document.education.map(e => [e.degree, e.field, e.institution, e.endDate].filter(Boolean).join(', ')));
  }
  if (document.certifications.length) {
    lines.push('', 'CERTIFICATIONS');
    lines.push(...document.certifications.map(c => [c.name, c.issuer, c.date].filter(Boolean).join(', ')));
  }
  return lines.join('\n');
}
