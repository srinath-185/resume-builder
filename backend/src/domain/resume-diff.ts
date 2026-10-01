import { containsTerm } from './keyword-match';
import { ResumeDocument, resumeToText } from './resume-document';

export interface ResumeChange {
  path: string;
  before?: string;
  after?: string;
  reason?: string;
}

const key = (value: string) => value.trim().toLowerCase();
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((item, i) => item === b[i]);

/**
 * Path-level differences between the master and a tailored resume, shown to
 * the user before approval. Reasons the model gave are attached by path.
 */
export function diffResumes(master: ResumeDocument, tailored: ResumeDocument, reasons: Array<{ path: string; reason: string }> = []): ResumeChange[] {
  const changes: ResumeChange[] = [];
  if ((master.headline ?? '') !== (tailored.headline ?? '')) changes.push({ path: 'headline', before: master.headline, after: tailored.headline });
  if ((master.summary ?? '') !== (tailored.summary ?? '')) changes.push({ path: 'summary', before: master.summary, after: tailored.summary });
  if (!sameList(master.skills, tailored.skills)) changes.push({ path: 'skills', before: master.skills.join(', '), after: tailored.skills.join(', ') });

  master.experience.forEach((role, index) => {
    const match = tailored.experience.find(candidate => key(candidate.company) === key(role.company) && key(candidate.title) === key(role.title));
    if (!match) {
      changes.push({ path: `experience[${index}]`, before: `${role.title} at ${role.company}`, after: undefined });
    } else if (!sameList(role.bullets, match.bullets)) {
      changes.push({ path: `experience[${index}].bullets`, before: role.bullets.join('\n'), after: match.bullets.join('\n') });
    }
  });

  master.projects.forEach((project, index) => {
    const match = tailored.projects.find(candidate => key(candidate.name) === key(project.name));
    if (!match) changes.push({ path: `projects[${index}]`, before: project.name, after: undefined });
    else if (!sameList(project.bullets, match.bullets) || (project.description ?? '') !== (match.description ?? '')) {
      changes.push({
        path: `projects[${index}]`,
        before: [project.description, ...project.bullets].filter(Boolean).join('\n'),
        after: [match.description, ...match.bullets].filter(Boolean).join('\n'),
      });
    }
  });

  for (const change of changes) {
    const reason = reasons.find(candidate => change.path === candidate.path || change.path.startsWith(`${candidate.path}.`) || candidate.path.startsWith(change.path));
    if (reason) change.reason = reason.reason;
  }
  return changes;
}

export interface KeywordCoverage {
  keywords: string[];
  before: number;
  after: number;
  missing: string[];
}

/** Share of the job's keywords that appear in each version, as a whole-number percentage. */
export function keywordCoverage(keywords: string[], master: ResumeDocument, tailored: ResumeDocument): KeywordCoverage {
  const firstSpelling = new Map<string, string>();
  for (const keyword of keywords) {
    const trimmed = keyword.trim();
    if (trimmed && !firstSpelling.has(trimmed.toLowerCase())) firstSpelling.set(trimmed.toLowerCase(), trimmed);
  }
  const unique = [...firstSpelling.values()].slice(0, 30);
  if (unique.length === 0) return { keywords: [], before: 0, after: 0, missing: [] };
  const beforeText = resumeToText(master).toLowerCase();
  const afterText = resumeToText(tailored).toLowerCase();
  const presentBefore = unique.filter(keyword => containsTerm(beforeText, keyword)).length;
  const missing = unique.filter(keyword => !containsTerm(afterText, keyword));
  return {
    keywords: unique,
    before: Math.round((100 * presentBefore) / unique.length),
    after: Math.round((100 * (unique.length - missing.length)) / unique.length),
    missing,
  };
}
