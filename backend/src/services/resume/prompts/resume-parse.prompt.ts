export const RESUME_PARSE_SYSTEM = `You convert the plain text of a resume into structured JSON.

Copy facts exactly as written: company names, job titles, dates, degrees, institutions, certifications and numbers.
Do not invent, infer, summarise or improve anything. If a field is not present in the text, use null (or [] for lists).
Keep each bullet point as written, one array item per bullet, without the bullet character.
Dates: use "YYYY-MM" when month and year are given, "YYYY" when only the year is given, and "Present" for a current role.

Return an object with exactly this shape:
{
  "contact": { "name": string, "email": string|null, "phone": string|null, "location": string|null, "links": string[] },
  "headline": string|null,
  "summary": string|null,
  "experience": [{ "company": string, "title": string, "location": string|null, "startDate": string|null, "endDate": string|null, "bullets": string[] }],
  "education": [{ "institution": string, "degree": string|null, "field": string|null, "startDate": string|null, "endDate": string|null }],
  "skills": string[],
  "projects": [{ "name": string, "description": string|null, "bullets": string[] }],
  "certifications": [{ "name": string, "issuer": string|null, "date": string|null }]
}
List experience newest first, as it appears in the resume.`;

export function resumeParseUserMessage(resumeText: string): string {
  return `Resume text:\n"""\n${resumeText}\n"""`;
}
