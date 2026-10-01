import { z } from 'zod';
import { useCreateOutreachTemplateMutation, useDeleteOutreachTemplateMutation, useListOutreachTemplatesQuery, useUpdateOutreachTemplateMutation } from '@/app/api/outreach';
import { Alert, Badge } from '@/common/components/ui';
import { createModuleComponent } from '@/common/crud/ModuleLoader';

export const PLACEHOLDERS = ['recruiterName', 'company', 'jobTitle', 'candidateName', 'coverNote', 'postUrl', 'senderName'];

const TemplatesModule = createModuleComponent({
  title: 'Email templates',
  description: 'Used to draft recruiter emails. Every draft also ends with a line offering to stop following up.',
  createLabel: 'New template',
  editTitle: 'Edit template',
  emptyTitle: 'No templates yet.',
  intro: (
    <div className="mb-4">
      <Alert>
        Placeholders: {PLACEHOLDERS.map(name => `{{${name}}}`).join(', ')}. A missing recruiter name reads “there”.
      </Alert>
    </div>
  ),
  useList: useListOutreachTemplatesQuery,
  useCreate: useCreateOutreachTemplateMutation,
  useUpdate: useUpdateOutreachTemplateMutation,
  useRemove: useDeleteOutreachTemplateMutation,
  defaults: { name: '', subject: 'Application: {{jobTitle}} at {{company}}', body: 'Hi {{recruiterName}},\n\n{{coverNote}}\n\nThanks,\n{{senderName}}', isDefault: false },
  columns: [
    { key: 'name', header: 'Name', render: template => <span className="font-medium">{template.name}</span> },
    { key: 'subject', header: 'Subject' },
    { key: 'isDefault', header: '', render: template => (template.isDefault ? <Badge tone="green">default</Badge> : null) },
  ],
  fields: [
    { name: 'name', label: 'Name' },
    { name: 'subject', label: 'Subject' },
    { name: 'body', label: 'Body', type: 'textarea', rows: 10 },
    { name: 'isDefault', label: 'Use by default', type: 'checkbox' },
  ],
  schema: z.object({
    name: z.string().trim().min(1, 'Required').max(80),
    subject: z.string().trim().min(1, 'Required').max(200),
    body: z.string().trim().min(1, 'Required').max(4000),
    isDefault: z.boolean().optional(),
  }),
  toForm: template => ({ name: template.name, subject: template.subject, body: template.body, isDefault: template.isDefault }),
  fromForm: values => ({ ...values, isDefault: Boolean(values.isDefault) }),
  deleteWarning: 'The template is removed; emails already drafted keep their text.',
});

export default TemplatesModule;
