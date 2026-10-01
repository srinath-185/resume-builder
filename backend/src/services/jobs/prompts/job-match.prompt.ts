import { z } from 'zod';

export const JOB_MATCH_SYSTEM = `You rate how well a candidate fits job postings, as a recruiter would screen them.

For each job, give a score from 0 to 100:
- 85–100: meets nearly all must-have requirements at the right seniority
- 65–84: meets most requirements; gaps are learnable or minor
- 40–64: partial fit; several important gaps
- 0–39: poor fit or wrong role/seniority

Judge only from the information given. Do not assume skills the candidate did not list.
Return {"results":[{"id":"<job id>","score":<0-100>,"reason":"<one sentence>","matchedSkills":[...],"missingSkills":[...]}]} with one entry per job.`;

export const JobMatchResultSchema = z.object({
  results: z.array(
    z.object({
      id: z.coerce.string(),
      score: z.coerce.number().min(0).max(100),
      reason: z.string().max(400).default(''),
      matchedSkills: z.array(z.string().max(80)).max(30).default([]),
      missingSkills: z.array(z.string().max(80)).max(30).default([]),
    }),
  ),
});

export type JobMatchResult = z.infer<typeof JobMatchResultSchema>;

const JD_CHARS_FOR_SCORING = 1500;

export interface CandidateSummary {
  targetTitles: string[];
  yearsExperience?: number;
  skills: string[];
  recentRoles: string[];
}

export function jobMatchUserMessage(candidate: CandidateSummary, jobs: Array<{ id: string; title: string; company: string; location?: string; description: string }>): string {
  const candidateBlock = [
    `Target roles: ${candidate.targetTitles.join(', ') || 'not specified'}`,
    `Years of experience: ${candidate.yearsExperience ?? 'unknown'}`,
    `Skills: ${candidate.skills.join(', ') || 'not specified'}`,
    ...(candidate.recentRoles.length ? [`Recent roles: ${candidate.recentRoles.join('; ')}`] : []),
  ].join('\n');

  const jobBlocks = jobs.map(job =>
    [`### Job ${job.id}`, `${job.title} at ${job.company}${job.location ? ` (${job.location})` : ''}`, job.description.slice(0, JD_CHARS_FOR_SCORING)].join('\n'),
  );
  return `## Candidate\n${candidateBlock}\n\n## Jobs\n${jobBlocks.join('\n\n')}`;
}
