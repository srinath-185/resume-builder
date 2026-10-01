import { z } from 'zod';
import { ResumeDocument, ResumeDocumentSchema } from '../../../domain/resume-document';

export const JD_KEYWORDS_SYSTEM = `You extract what a job description asks for.
Return {"mustHave": string[], "niceToHave": string[], "seniority": string|null}.
mustHave: up to 15 concrete skills, tools, technologies, domains or certifications the posting requires.
niceToHave: up to 10 that are listed as a plus or preferred.
Use the posting's own wording (e.g. "Node.js", "Kubernetes", "PCI DSS"); no soft skills, no sentences.`;

export const JdKeywordsSchema = z.object({
  mustHave: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  niceToHave: z.array(z.string().trim().min(1).max(60)).max(15).default([]),
  seniority: z.string().max(40).nullish().transform(value => value || undefined),
});

export const TAILOR_SYSTEM = `You tailor a candidate's resume to one job. The candidate will review your version before anything is sent.

You may:
- rewrite the headline and summary to target this role, using only facts from the resume;
- reorder skills so the ones this job asks for come first, and drop irrelevant ones;
- rephrase bullets to use the job's terminology where the resume already supports it;
- reorder bullets within a role, and drop bullets or projects that do not help for this job.

You must not:
- add, rename or remove employers, job titles, or change any dates;
- add degrees, certifications, projects, tools or skills the resume does not mention;
- add or change any number, percentage, amount, team size or duration;
- claim experience with a requirement the resume does not show — leave that gap visible.

Keep every role from the resume with its exact company, title, startDate and endDate.
Contact details must be copied unchanged.

Also write:
- coverNote: 120–180 words, first person, specific to this company and role, facts from the resume only;
- formAnswers: up to 5 likely screening questions for this job with answers drawn only from the resume
  (skip any question the resume cannot answer, such as notice period or salary).

Return {"document": <resume in the same JSON shape as the input>, "changes": [{"path": "summary" | "skills" | "experience[i].bullets" | ..., "reason": "<why, tied to the job>"}], "coverNote": string, "formAnswers": [{"question": string, "answer": string}]}.`;

export const TailorOutputSchema = z.object({
  document: ResumeDocumentSchema,
  changes: z.array(z.object({ path: z.string().max(120), reason: z.string().max(400) })).max(60).default([]),
  coverNote: z.string().max(3000).default(''),
  formAnswers: z
    .array(z.object({ question: z.string().trim().min(1).max(300), answer: z.string().trim().min(1).max(2000) }))
    .max(10)
    .default([]),
});

export type TailorOutput = z.infer<typeof TailorOutputSchema>;

const JD_CHARS_FOR_TAILORING = 6000;

export interface TailorContext {
  job: { title: string; company: string; location?: string; description: string };
  keywords: { mustHave: string[]; niceToHave: string[] };
  master: ResumeDocument;
  instructions?: string;
}

export function tailorUserMessage(context: TailorContext): string {
  return [
    `## Job\n${context.job.title} at ${context.job.company}${context.job.location ? ` (${context.job.location})` : ''}`,
    context.job.description.slice(0, JD_CHARS_FOR_TAILORING),
    `## What the job asks for\nMust have: ${context.keywords.mustHave.join(', ') || 'n/a'}\nNice to have: ${context.keywords.niceToHave.join(', ') || 'n/a'}`,
    `## Resume (JSON)\n${JSON.stringify(context.master)}`,
    ...(context.instructions ? [`## Candidate's instructions for this version\n${context.instructions}`] : []),
  ].join('\n\n');
}
