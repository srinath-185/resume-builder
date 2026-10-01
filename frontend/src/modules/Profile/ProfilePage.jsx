import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useGetProfileQuery, useResumeTemplatesQuery, useUpdateProfileMutation } from '@/app/api/resumes';
import { Alert, Button, Card, ErrorMessage, Field, Input, PageHeader, Select, Spinner, TextArea } from '@/common/components/ui';

const cap = z.coerce.number().int().min(0, 'Must be 0 or more').max(200, 'At most 200');

export const ProfileSchema = z.object({
  targetTitles: z.string().max(1000),
  skills: z.string().max(6000),
  yearsExperience: z.union([z.literal(''), z.coerce.number().int().min(0).max(60)]),
  location: z.string().max(120),
  remoteOnly: z.boolean(),
  seniority: z.string().max(60),
  autoTailorThreshold: z.coerce.number().int().min(0, '0–101').max(101, '0–101'),
  tailorCap: cap,
  applyCap: cap,
  outreachCap: cap,
  defaultTemplateId: z.string(),
  hiringQueryTemplate: z.string().max(300).refine(value => !value.trim() || value.includes('{title}'), 'Must contain {title}'),
  autoApplyOnApprove: z.boolean(),
});

const list = text =>
  text
    .split(/[\n,]/)
    .map(item => item.trim())
    .filter(Boolean);

export function toProfileForm(profile) {
  return {
    targetTitles: (profile.targetTitles ?? []).join(', '),
    skills: (profile.skills ?? []).join(', '),
    yearsExperience: profile.yearsExperience ?? '',
    location: profile.location ?? '',
    remoteOnly: Boolean(profile.remoteOnly),
    seniority: profile.seniority ?? '',
    autoTailorThreshold: profile.autoTailorThreshold ?? 75,
    tailorCap: profile.dailyCaps?.tailor ?? 10,
    applyCap: profile.dailyCaps?.apply ?? 15,
    outreachCap: profile.dailyCaps?.outreach ?? 10,
    defaultTemplateId: profile.defaultTemplateId ?? 'classic',
    hiringQueryTemplate: profile.hiringQueryTemplate ?? '',
    autoApplyOnApprove: Boolean(profile.autoApplyOnApprove),
  };
}

export function fromProfileForm(values) {
  return {
    targetTitles: list(values.targetTitles).slice(0, 10),
    skills: list(values.skills),
    ...(values.yearsExperience === '' ? {} : { yearsExperience: Number(values.yearsExperience) }),
    location: values.location.trim() || null,
    remoteOnly: values.remoteOnly,
    seniority: values.seniority.trim() || null,
    autoTailorThreshold: Number(values.autoTailorThreshold),
    dailyCaps: { tailor: Number(values.tailorCap), apply: Number(values.applyCap), outreach: Number(values.outreachCap) },
    defaultTemplateId: values.defaultTemplateId || null,
    hiringQueryTemplate: values.hiringQueryTemplate.trim() || null,
    autoApplyOnApprove: values.autoApplyOnApprove,
  };
}

export default function ProfilePage() {
  const { t } = useTranslation();
  const { data: profile, isLoading, error } = useGetProfileQuery();
  const { data: templates } = useResumeTemplatesQuery();
  const [save, saveState] = useUpdateProfileMutation();
  const { register, handleSubmit, reset, formState } = useForm({ resolver: zodResolver(ProfileSchema) });

  useEffect(() => {
    if (profile) reset(toProfileForm(profile));
  }, [profile, reset]);

  if (isLoading) return <Spinner />;
  const errors = formState.errors;

  return (
    <div>
      <PageHeader title={t('profile.title', 'Search profile')} description={t('profile.description', 'What you are looking for. Seeded from your first resume; your edits are never overwritten.')} />
      <ErrorMessage error={error} />
      <form onSubmit={handleSubmit(values => save(fromProfileForm(values)))} className="space-y-4" noValidate>
        <Card title={t('profile.target', 'Target roles')}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t('profile.titles', 'Target job titles (comma separated, up to 10)')} htmlFor="targetTitles" error={errors.targetTitles?.message}>
              <TextArea id="targetTitles" rows={2} {...register('targetTitles')} />
            </Field>
            <Field label={t('profile.skills', 'Skills (comma separated)')} htmlFor="skills" error={errors.skills?.message}>
              <TextArea id="skills" rows={2} {...register('skills')} />
            </Field>
            <Field label={t('profile.location', 'Location')} hint={t('profile.locationHint', 'Leave empty to search anywhere.')} htmlFor="location">
              <Input id="location" {...register('location')} />
            </Field>
            <Field label={t('profile.years', 'Years of experience')} htmlFor="yearsExperience" error={errors.yearsExperience && t('profile.yearsInvalid', 'Enter a number from 0 to 60')}>
              <Input id="yearsExperience" type="number" {...register('yearsExperience')} />
            </Field>
            <Field label={t('profile.seniority', 'Seniority')} htmlFor="seniority">
              <Input id="seniority" placeholder="Senior" {...register('seniority')} />
            </Field>
            <label className="flex items-center gap-2 self-end text-sm">
              <input type="checkbox" className="size-4" {...register('remoteOnly')} />
              {t('profile.remoteOnly', 'Remote only')}
            </label>
          </div>
        </Card>

        <Card title={t('profile.automation', 'Automation and limits')}>
          <Alert>{t('profile.reviewPromise', 'Tailored resumes are always drafts until you approve them. Nothing is applied or emailed before that.')}</Alert>
          <div className="mt-4 grid gap-4 md:grid-cols-4">
            <Field label={t('profile.threshold', 'Auto-draft at match score ≥')} hint={t('profile.thresholdHint', '101 turns automatic drafting off.')} htmlFor="autoTailorThreshold" error={errors.autoTailorThreshold?.message}>
              <Input id="autoTailorThreshold" type="number" {...register('autoTailorThreshold')} />
            </Field>
            <Field label={t('profile.tailorCap', 'Tailored resumes / day')} htmlFor="tailorCap" error={errors.tailorCap?.message}>
              <Input id="tailorCap" type="number" {...register('tailorCap')} />
            </Field>
            <Field label={t('profile.applyCap', 'Applications / day')} htmlFor="applyCap" error={errors.applyCap?.message}>
              <Input id="applyCap" type="number" {...register('applyCap')} />
            </Field>
            <Field label={t('profile.outreachCap', 'Recruiter emails / day')} htmlFor="outreachCap" error={errors.outreachCap?.message}>
              <Input id="outreachCap" type="number" {...register('outreachCap')} />
            </Field>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" {...register('autoApplyOnApprove')} />
            {t('profile.autoApply', 'Start the assisted apply as soon as I approve a tailored resume')}
          </label>
        </Card>

        <Card title={t('profile.output', 'Resume and search settings')}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t('profile.template', 'Default resume template')} htmlFor="defaultTemplateId">
              <Select id="defaultTemplateId" {...register('defaultTemplateId')}>
                {(templates ?? []).map(template => (
                  <option key={template.id} value={template.id}>
                    {template.name} — {template.description}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t('profile.hiringQuery', 'LinkedIn hiring-post query')}
              hint={t('profile.hiringQueryHint', 'Default: "hiring" AND "{title}" AND "{location}". The location part is dropped when location is empty.')}
              htmlFor="hiringQueryTemplate"
              error={errors.hiringQueryTemplate?.message}
            >
              <Input id="hiringQueryTemplate" placeholder='"hiring" AND "{title}" AND "{location}"' {...register('hiringQueryTemplate')} />
            </Field>
          </div>
        </Card>

        <ErrorMessage error={saveState.error} />
        {saveState.isSuccess && <Alert tone="green">{t('profile.saved', 'Profile saved.')}</Alert>}
        <div className="flex justify-end">
          <Button type="submit" loading={saveState.isLoading}>
            {t('common.save', 'Save')}
          </Button>
        </div>
      </form>
    </div>
  );
}
