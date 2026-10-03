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

const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.in', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'rediffmail.com', 'gmx.com', 'mail.com', 'zoho.com', 'yandex.com',
]);

/** "jobs@acme-labs.io" → "Acme Labs"; undefined for free-mail addresses, which say nothing about the employer. */
export function companyFromEmail(email: string): string | undefined {
  const domain = email.split('@')[1]?.toLowerCase().trim();
  if (!domain || FREE_MAIL_DOMAINS.has(domain)) return undefined;
  const parts = domain.split('.');
  // Skip second-level suffixes such as co.in / com.au.
  const name = parts.length > 2 && parts.at(-2)!.length <= 3 ? parts.at(-3) : parts.at(-2);
  if (!name) return undefined;
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map(word => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}
