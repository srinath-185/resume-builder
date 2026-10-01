import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { useListApplicationsQuery } from '@/app/api/applications';
import { useDraftOutreachMutation, useListContactsQuery, useListOutreachTemplatesQuery, useMailConnectorQuery } from '@/app/api/outreach';
import { Alert, Button, Card, ErrorMessage, Field, Input, PageHeader, Select, Spinner } from '@/common/components/ui';

const APPROVED = ['APPROVED', 'APPLYING', 'APPLIED', 'NEEDS_REVIEW', 'FAILED'];

export const ComposeSchema = z
  .object({
    applicationId: z.string().min(1, 'Choose the job this email is about'),
    contactId: z.string(),
    email: z.string().trim(),
    name: z.string().trim().max(120),
    templateId: z.string(),
    personalise: z.boolean(),
    hiringPostId: z.string(),
  })
  .refine(values => values.contactId || z.string().email().safeParse(values.email).success, { path: ['email'], message: 'Choose a contact or enter a valid email' });

/** Drafts an email for a job whose tailored resume is approved; the draft opens for review before sending. */
export default function ComposePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data: applications, isLoading } = useListApplicationsQuery();
  const { data: contacts } = useListContactsQuery();
  const { data: templates } = useListOutreachTemplatesQuery();
  const { data: mail } = useMailConnectorQuery();
  const [draft, draftState] = useDraftOutreachMutation();
  const approved = (applications ?? []).filter(application => APPROVED.includes(application.status));

  const { register, handleSubmit, formState } = useForm({
    resolver: zodResolver(ComposeSchema),
    values: {
      applicationId: params.get('applicationId') ?? '',
      contactId: '',
      email: params.get('email') ?? '',
      name: params.get('name') ?? '',
      templateId: '',
      personalise: false,
      hiringPostId: params.get('hiringPostId') ?? '',
    },
  });

  const submit = async values => {
    const body = {
      applicationId: values.applicationId,
      ...(values.contactId ? { contactId: values.contactId } : { email: values.email, ...(values.name ? { name: values.name } : {}) }),
      ...(values.templateId ? { templateId: values.templateId } : {}),
      ...(values.hiringPostId ? { hiringPostId: values.hiringPostId } : {}),
      personalise: values.personalise,
    };
    const result = await draft(body);
    if (result.data) navigate(`/outreach?open=${result.data.id}`);
  };

  if (isLoading) return <Spinner />;
  return (
    <div>
      <PageHeader title={t('compose.title', 'Email a recruiter')} description={t('compose.description', 'Your approved tailored resume is attached. You review the draft before it is sent.')} />
      {!mail?.connected && (
        <div className="mb-4">
          <Alert tone="amber">
            {t('compose.noMailbox', 'Connect your mailbox before sending.')}{' '}
            <Link to="/settings/mail" className="font-medium underline">
              {t('compose.connect', 'Connect now')}
            </Link>
          </Alert>
        </div>
      )}
      {approved.length === 0 ? (
        <Alert tone="amber">{t('compose.noApproved', 'Approve a tailored resume first; emails always attach an approved version.')}</Alert>
      ) : (
        <Card>
          <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
            <Field label={t('compose.job', 'Job')} htmlFor="applicationId" error={formState.errors.applicationId?.message}>
              <Select id="applicationId" {...register('applicationId')}>
                <option value="">{t('compose.chooseJob', 'Choose…')}</option>
                {approved.map(application => (
                  <option key={application.id} value={application.id}>
                    {application.jobTitle} — {application.company} ({application.status.toLowerCase().replace(/_/g, ' ')})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('compose.contact', 'Existing contact')} htmlFor="contactId">
              <Select id="contactId" {...register('contactId')}>
                <option value="">{t('compose.newRecipient', '— new recipient below —')}</option>
                {(contacts ?? [])
                  .filter(contact => !contact.doNotContact)
                  .map(contact => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name ? `${contact.name} <${contact.email}>` : contact.email}
                    </option>
                  ))}
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('compose.email', 'Recipient email')} htmlFor="email" error={formState.errors.email?.message}>
                <Input id="email" type="email" {...register('email')} />
              </Field>
              <Field label={t('compose.name', 'Recipient name')} htmlFor="name">
                <Input id="name" {...register('name')} />
              </Field>
            </div>
            <Field label={t('compose.template', 'Template')} htmlFor="templateId">
              <Select id="templateId" {...register('templateId')}>
                <option value="">{t('compose.defaultTemplate', 'Default template')}</option>
                {(templates ?? []).map(template => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" {...register('personalise')} />
              {t('compose.personalise', 'Personalise with AI (never adds facts; falls back to the template if it tries)')}
            </label>
            <input type="hidden" {...register('hiringPostId')} />
            <ErrorMessage error={draftState.error} />
            <div className="flex justify-end">
              <Button type="submit" loading={draftState.isLoading}>
                {t('compose.draft', 'Create draft')}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
