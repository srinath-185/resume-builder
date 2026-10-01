import { z } from 'zod';

export const OUTREACH_PERSONALISE_SYSTEM = `You personalise a short email from a job seeker to a recruiter.
Keep it under 160 words, warm and specific. If a hiring post is given, mention what it said in one sentence.
Use only facts already present in the draft or the post. Do not add numbers, skills, employers or claims.
Keep the sign-off and any line about not following up exactly as written.
Return {"subject": string, "body": string}.`;

export const PersonalisedSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  body: z.string().trim().min(20).max(4000),
});

export function personaliseUserMessage(draft: { subject: string; body: string }, postText?: string): string {
  return [`## Draft\nSubject: ${draft.subject}\n\n${draft.body}`, ...(postText ? [`## Hiring post\n${postText.slice(0, 1500)}`] : [])].join('\n\n');
}
