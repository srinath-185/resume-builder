import { containsTerm } from './keyword-match';
import { ResumeDocument, resumeToText } from './resume-document';

export type FactViolationKind =
  | 'unknown_role'
  | 'changed_dates'
  | 'unknown_education'
  | 'unknown_certification'
  | 'unknown_project'
  | 'changed_contact'
  | 'unsupported_skill'
  | 'new_number';

export interface FactViolation {
  path: string;
  kind: FactViolationKind;
  value: string;
}

export interface FactCheckResult {
  passed: boolean;
  violations: FactViolation[];
}

const same = (a?: string, b?: string) => (a ?? '').trim().replace(/\s+/g, ' ').toLowerCase() === (b ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Digits as written, minus thousands separators and trailing punctuation: "1,200" → "1200", "40%" → "40". */
export function numbersIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(/\d[\d,.]*\d|\d/g)) {
    found.add(match[0].replace(/,/g, '').replace(/\.$/, ''));
  }
  return found;
}

/**
 * The guard behind the tailoring prompt. A tailored resume may reorder,
 * rephrase, emphasise and drop content; it may not introduce an employer,
 * title, date, degree, certification, project, contact detail, skill or number
 * that the master resume (structured document plus the raw uploaded text) does
 * not already contain. A variant that fails cannot be approved.
 */
export function factCheck(master: ResumeDocument, masterText: string, tailored: ResumeDocument): FactCheckResult {
  const violations: FactViolation[] = [];
  const source = `${masterText}\n${resumeToText(master)}`.toLowerCase();
  const sourceNumbers = numbersIn(source);

  if (!same(tailored.contact.name, master.contact.name)) violations.push({ path: 'contact.name', kind: 'changed_contact', value: tailored.contact.name });
  for (const field of ['email', 'phone'] as const) {
    if (tailored.contact[field] && !same(tailored.contact[field], master.contact[field])) {
      violations.push({ path: `contact.${field}`, kind: 'changed_contact', value: tailored.contact[field]! });
    }
  }

  tailored.experience.forEach((role, index) => {
    const original = master.experience.find(candidate => same(candidate.company, role.company) && same(candidate.title, role.title));
    if (!original) {
      violations.push({ path: `experience[${index}]`, kind: 'unknown_role', value: `${role.title} at ${role.company}` });
      return;
    }
    if (!same(original.startDate, role.startDate) || !same(original.endDate, role.endDate)) {
      violations.push({ path: `experience[${index}]`, kind: 'changed_dates', value: `${role.startDate ?? '?'} – ${role.endDate ?? '?'}` });
    }
  });

  tailored.education.forEach((entry, index) => {
    const original = master.education.find(candidate => same(candidate.institution, entry.institution) && same(candidate.degree, entry.degree));
    if (!original) violations.push({ path: `education[${index}]`, kind: 'unknown_education', value: [entry.degree, entry.institution].filter(Boolean).join(', ') });
    else if (!same(original.endDate, entry.endDate) || !same(original.startDate, entry.startDate)) {
      violations.push({ path: `education[${index}]`, kind: 'changed_dates', value: `${entry.startDate ?? '?'} – ${entry.endDate ?? '?'}` });
    }
  });

  tailored.certifications.forEach((cert, index) => {
    if (!master.certifications.some(candidate => same(candidate.name, cert.name))) {
      violations.push({ path: `certifications[${index}]`, kind: 'unknown_certification', value: cert.name });
    }
  });

  tailored.projects.forEach((project, index) => {
    if (!master.projects.some(candidate => same(candidate.name, project.name))) {
      violations.push({ path: `projects[${index}]`, kind: 'unknown_project', value: project.name });
    }
  });

  tailored.skills.forEach((skill, index) => {
    if (!containsTerm(source, skill)) violations.push({ path: `skills[${index}]`, kind: 'unsupported_skill', value: skill });
  });

  const prose: Array<[string, string | undefined]> = [
    ['headline', tailored.headline],
    ['summary', tailored.summary],
    ...tailored.experience.flatMap((role, i) => role.bullets.map((bullet, j) => [`experience[${i}].bullets[${j}]`, bullet] as [string, string])),
    ...tailored.projects.flatMap((project, i) => [
      [`projects[${i}].description`, project.description] as [string, string | undefined],
      ...project.bullets.map((bullet, j) => [`projects[${i}].bullets[${j}]`, bullet] as [string, string]),
    ]),
  ];
  for (const [path, text] of prose) {
    if (!text) continue;
    for (const number of numbersIn(text)) {
      if (!sourceNumbers.has(number)) violations.push({ path, kind: 'new_number', value: number });
    }
  }

  return { passed: violations.length === 0, violations };
}
