import { ResumeDocument } from '../../domain/resume-document';

/** Builds a valid single-page PDF with one text line per entry (correct xref offsets). */
export function minimalPdf(lines: string[]): Buffer {
  // Standard Type1 fonts only cover printable ASCII safely; anything else becomes "-".
  const escape = (value: string) => value.replace(/[^\x20-\x7e]/g, '-').replace(/([()\\])/g, '\\$1');
  const content = ['BT', '/F1 11 Tf', '72 740 Td', ...lines.flatMap((line, i) => [...(i ? ['0 -15 Td'] : []), `(${escape(line)}) Tj`]), 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

export const SAMPLE_RESUME_TEXT = `Priya Raman
priya.raman@example.test | +91 98765 43210 | Chennai, India
Senior Backend Engineer

EXPERIENCE
Senior Software Engineer, Acme Payments — 2021-03 to Present
- Led migration of the settlement service to Node.js, cutting batch time by 40%
- Designed idempotent payout APIs used by 1,200 merchants
Software Engineer, Brightlabs — 2018-06 to 2021-02
- Built REST APIs in TypeScript and MongoDB
- Introduced CI pipelines with GitHub Actions

EDUCATION
B.E. Computer Science, Anna University, 2018

SKILLS
Node.js, TypeScript, MongoDB, Redis, AWS, Docker, REST, Kafka`;

export const SAMPLE_RESUME_DOCUMENT: ResumeDocument = {
  contact: { name: 'Priya Raman', email: 'priya.raman@example.test', phone: '+91 98765 43210', location: 'Chennai, India', links: [] },
  headline: 'Senior Backend Engineer',
  summary: undefined,
  experience: [
    {
      company: 'Acme Payments',
      title: 'Senior Software Engineer',
      location: undefined,
      startDate: '2021-03',
      endDate: 'Present',
      bullets: ['Led migration of the settlement service to Node.js, cutting batch time by 40%', 'Designed idempotent payout APIs used by 1,200 merchants'],
    },
    {
      company: 'Brightlabs',
      title: 'Software Engineer',
      location: undefined,
      startDate: '2018-06',
      endDate: '2021-02',
      bullets: ['Built REST APIs in TypeScript and MongoDB', 'Introduced CI pipelines with GitHub Actions'],
    },
  ],
  education: [{ institution: 'Anna University', degree: 'B.E.', field: 'Computer Science', startDate: undefined, endDate: '2018' }],
  skills: ['Node.js', 'TypeScript', 'MongoDB', 'Redis', 'AWS', 'Docker', 'REST', 'Kafka'],
  projects: [],
  certifications: [],
};

/** The JSON a model would return for SAMPLE_RESUME_TEXT (nulls where absent, as prompted). */
export const SAMPLE_PARSE_REPLY = JSON.stringify({
  ...SAMPLE_RESUME_DOCUMENT,
  summary: null,
  experience: SAMPLE_RESUME_DOCUMENT.experience.map(role => ({ ...role, location: null })),
  education: SAMPLE_RESUME_DOCUMENT.education.map(entry => ({ ...entry, startDate: null })),
});
