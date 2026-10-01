export const TEMPLATE_PLACEHOLDERS = ['recruiterName', 'company', 'jobTitle', 'candidateName', 'coverNote', 'postUrl', 'senderName'] as const;
export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number];

export type TemplateValues = Partial<Record<TemplatePlaceholder, string | undefined>>;

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

export function unknownPlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map(match => match[1]))].filter(
    name => !(TEMPLATE_PLACEHOLDERS as readonly string[]).includes(name),
  );
}

/** Replaces {{placeholders}}; a missing recruiter name reads "there" ("Hi there,"), anything else missing becomes empty. */
export function renderTemplate(text: string, values: TemplateValues): string {
  return text
    .replace(PLACEHOLDER, (_match, name: string) => {
      const value = values[name as TemplatePlaceholder]?.trim();
      if (value) return value;
      return name === 'recruiterName' ? 'there' : '';
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const OPT_OUT_LINE = "If you'd rather not hear from me again, just reply and say so — I won't follow up.";

export const DEFAULT_TEMPLATE = {
  name: 'Application note',
  subject: 'Application: {{jobTitle}} at {{company}}',
  body: `Hi {{recruiterName}},

I'm applying for the {{jobTitle}} role at {{company}} and have attached my resume.

{{coverNote}}

Thank you for your time,
{{senderName}}`,
};

export const FOLLOW_UP_BODY = `Hi {{recruiterName}},

Following up on my note about the {{jobTitle}} role at {{company}}. I'm still very interested and happy to share anything else that would help.

Thanks,
{{senderName}}`;
