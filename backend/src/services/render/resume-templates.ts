import { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import { ResumeDocument } from '../../domain/resume-document';

export interface TemplateStyle {
  accent: string;
  baseFontSize: number;
  nameSize: number;
  headerAlign: 'left' | 'center';
  sectionRule: boolean;
  margins: [number, number, number, number];
  /** Order of sections after the header. */
  sections: Array<'summary' | 'experience' | 'skills' | 'projects' | 'education' | 'certifications'>;
}

export interface ResumeTemplate {
  id: string;
  name: string;
  description: string;
  style: TemplateStyle;
}

/**
 * Single-column, real-text layouts only: applicant tracking systems read
 * these reliably, unlike multi-column or image-based designs.
 */
export const RESUME_TEMPLATES: ResumeTemplate[] = [
  {
    id: 'classic',
    name: 'Classic',
    description: 'Centered header, ruled sections. Safe default for any ATS.',
    style: {
      accent: '#1f2937',
      baseFontSize: 10,
      nameSize: 20,
      headerAlign: 'center',
      sectionRule: true,
      margins: [48, 40, 48, 40],
      sections: ['summary', 'experience', 'skills', 'projects', 'education', 'certifications'],
    },
  },
  {
    id: 'modern',
    name: 'Modern',
    description: 'Left-aligned header with a blue accent; skills before experience.',
    style: {
      accent: '#1d4ed8',
      baseFontSize: 10,
      nameSize: 22,
      headerAlign: 'left',
      sectionRule: false,
      margins: [44, 40, 44, 40],
      sections: ['summary', 'skills', 'experience', 'projects', 'education', 'certifications'],
    },
  },
  {
    id: 'compact',
    name: 'Compact',
    description: 'Tighter spacing to fit long histories on fewer pages.',
    style: {
      accent: '#111827',
      baseFontSize: 9,
      nameSize: 17,
      headerAlign: 'left',
      sectionRule: true,
      margins: [36, 30, 36, 30],
      sections: ['summary', 'experience', 'skills', 'education', 'projects', 'certifications'],
    },
  },
];

export const DEFAULT_TEMPLATE_ID = 'classic';

export function findTemplate(id: string | undefined): ResumeTemplate | undefined {
  return RESUME_TEMPLATES.find(template => template.id === (id ?? DEFAULT_TEMPLATE_ID));
}

function dateRange(start?: string, end?: string): string {
  if (!start && !end) return '';
  return `${start ?? ''} – ${end ?? 'Present'}`.trim();
}

function sectionTitle(title: string, style: TemplateStyle): Content[] {
  const heading: Content = { text: title.toUpperCase(), style: 'section', margin: [0, 10, 0, 2] };
  if (!style.sectionRule) return [heading];
  return [
    heading,
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.6, lineColor: style.accent }], margin: [0, 0, 0, 4] },
  ];
}

function bullets(items: string[]): Content | undefined {
  return items.length ? { ul: items, margin: [0, 2, 0, 0] } : undefined;
}

function sectionContent(document: ResumeDocument, section: TemplateStyle['sections'][number], style: TemplateStyle): Content[] {
  switch (section) {
    case 'summary':
      return document.summary ? [...sectionTitle('Summary', style), { text: document.summary }] : [];
    case 'skills':
      return document.skills.length ? [...sectionTitle('Skills', style), { text: document.skills.join(' • ') }] : [];
    case 'experience':
      if (!document.experience.length) return [];
      return [
        ...sectionTitle('Experience', style),
        ...document.experience.map(
          (role): Content => ({
            stack: [
              {
                columns: [
                  { text: [{ text: role.title, bold: true }, { text: `, ${role.company}` }], width: '*' },
                  { text: dateRange(role.startDate, role.endDate), width: 'auto', style: 'muted' },
                ],
              },
              ...(role.location ? [{ text: role.location, style: 'muted' } as Content] : []),
              ...([bullets(role.bullets)].filter(Boolean) as Content[]),
            ],
            margin: [0, 4, 0, 2],
            unbreakable: role.bullets.length <= 6,
          }),
        ),
      ];
    case 'projects':
      if (!document.projects.length) return [];
      return [
        ...sectionTitle('Projects', style),
        ...document.projects.map(
          (project): Content => ({
            stack: [
              { text: [{ text: project.name, bold: true }, ...(project.description ? [{ text: ` — ${project.description}` }] : [])] },
              ...([bullets(project.bullets)].filter(Boolean) as Content[]),
            ],
            margin: [0, 3, 0, 2],
          }),
        ),
      ];
    case 'education':
      if (!document.education.length) return [];
      return [
        ...sectionTitle('Education', style),
        ...document.education.map(
          (entry): Content => ({
            columns: [
              { text: [entry.degree, entry.field].filter(Boolean).join(', ') + (entry.degree || entry.field ? ' — ' : '') + entry.institution, width: '*' },
              { text: dateRange(entry.startDate, entry.endDate ?? undefined), width: 'auto', style: 'muted' },
            ],
            margin: [0, 2, 0, 0],
          }),
        ),
      ];
    case 'certifications':
      if (!document.certifications.length) return [];
      return [
        ...sectionTitle('Certifications', style),
        { ul: document.certifications.map(cert => [cert.name, cert.issuer, cert.date].filter(Boolean).join(', ')) },
      ];
  }
}

export function buildDocDefinition(document: ResumeDocument, template: ResumeTemplate): TDocumentDefinitions {
  const { style } = template;
  const contactLine = [document.contact.email, document.contact.phone, document.contact.location, ...document.contact.links]
    .filter(Boolean)
    .join('  |  ');

  return {
    info: { title: `${document.contact.name} — Resume`, author: document.contact.name, creator: 'resume-builder' },
    pageSize: 'A4',
    pageMargins: style.margins,
    defaultStyle: { font: 'Roboto', fontSize: style.baseFontSize, lineHeight: 1.2, color: '#111827' },
    styles: {
      name: { fontSize: style.nameSize, bold: true, color: style.accent },
      headline: { fontSize: style.baseFontSize + 1, color: '#374151' },
      section: { fontSize: style.baseFontSize + 1, bold: true, color: style.accent, characterSpacing: 0.5 },
      muted: { color: '#4b5563', fontSize: style.baseFontSize - 0.5 },
    },
    content: [
      { text: document.contact.name, style: 'name', alignment: style.headerAlign },
      ...(document.headline ? [{ text: document.headline, style: 'headline', alignment: style.headerAlign } as Content] : []),
      ...(contactLine ? [{ text: contactLine, style: 'muted', alignment: style.headerAlign, margin: [0, 2, 0, 0] } as Content] : []),
      ...style.sections.flatMap(section => sectionContent(document, section, style)),
    ],
  };
}
