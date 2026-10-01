import { Plus, Trash2 } from 'lucide-react';
import { useFieldArray, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Button, Field, Input, TextArea } from '../components/ui';
import { fromResumeForm, toResumeForm } from './resumeForm';

const EMPTY = {
  experience: { company: '', title: '', location: '', startDate: '', endDate: '', bullets: '' },
  education: { institution: '', degree: '', field: '', startDate: '', endDate: '' },
  projects: { name: '', description: '', bullets: '' },
  certifications: { name: '', issuer: '', date: '' },
};

function Section({ title, onAdd, addLabel, children }) {
  return (
    <fieldset className="space-y-3 rounded-md border border-slate-200 p-3">
      <legend className="px-1 text-sm font-semibold text-slate-800">{title}</legend>
      {children}
      {onAdd && (
        <Button variant="secondary" icon={Plus} onClick={onAdd}>
          {addLabel}
        </Button>
      )}
    </fieldset>
  );
}

function Remove({ onClick, label }) {
  return <Button variant="ghost" icon={Trash2} aria-label={label} onClick={onClick} className="self-start" />;
}

/**
 * Edits a structured resume. Bullets are one per line; skills are comma
 * separated. `highlight` (paths → reason) marks fields the reviewer must look at.
 */
export function ResumeDocumentEditor({ document, onSave, saving, saveLabel, extraActions, highlight = {}, readOnly = false }) {
  const { t } = useTranslation();
  const { register, control, handleSubmit, formState } = useForm({ defaultValues: toResumeForm(document) });
  const experience = useFieldArray({ control, name: 'experience' });
  const education = useFieldArray({ control, name: 'education' });
  const projects = useFieldArray({ control, name: 'projects' });
  const certifications = useFieldArray({ control, name: 'certifications' });

  const flag = path => (highlight[path] ? <p className="text-xs font-medium text-red-600">⚠ {highlight[path]}</p> : null);

  return (
    <form onSubmit={handleSubmit(values => onSave(fromResumeForm(values)))} className="space-y-4" noValidate>
      <fieldset disabled={readOnly} className="space-y-4">
      <Section title={t('resume.contact', 'Contact')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('resume.name', 'Name')} error={formState.errors.contact?.name && t('resume.nameRequired', 'Name is required')} htmlFor="contact.name">
            <Input id="contact.name" {...register('contact.name', { required: true })} />
          </Field>
          <Field label={t('resume.email', 'Email')} htmlFor="contact.email">
            <Input id="contact.email" {...register('contact.email')} />
          </Field>
          <Field label={t('resume.phone', 'Phone')} htmlFor="contact.phone">
            <Input id="contact.phone" {...register('contact.phone')} />
          </Field>
          <Field label={t('resume.location', 'Location')} htmlFor="contact.location">
            <Input id="contact.location" {...register('contact.location')} />
          </Field>
        </div>
        <Field label={t('resume.links', 'Links (one per line)')} htmlFor="contact.links">
          <TextArea id="contact.links" rows={2} {...register('contact.links')} />
        </Field>
      </Section>

      <Section title={t('resume.summarySection', 'Headline and summary')}>
        <Field label={t('resume.headline', 'Headline')} htmlFor="headline">
          <Input id="headline" {...register('headline')} />
        </Field>
        {flag('headline')}
        <Field label={t('resume.summary', 'Summary')} htmlFor="summary">
          <TextArea id="summary" rows={4} {...register('summary')} />
        </Field>
        {flag('summary')}
      </Section>

      <Section title={t('resume.experience', 'Experience')} onAdd={() => experience.append(EMPTY.experience)} addLabel={t('resume.addRole', 'Add role')}>
        {experience.fields.map((role, index) => (
          <div key={role.id} className="space-y-2 rounded-md bg-slate-50 p-3">
            {flag(`experience[${index}]`)}
            <div className="flex gap-2">
              <div className="grid flex-1 gap-2 sm:grid-cols-2">
                <Input aria-label={t('resume.title', 'Title')} placeholder={t('resume.title', 'Title')} {...register(`experience.${index}.title`)} />
                <Input aria-label={t('resume.company', 'Company')} placeholder={t('resume.company', 'Company')} {...register(`experience.${index}.company`)} />
                <Input aria-label={t('resume.start', 'Start (YYYY-MM)')} placeholder={t('resume.start', 'Start (YYYY-MM)')} {...register(`experience.${index}.startDate`)} />
                <Input aria-label={t('resume.end', 'End (YYYY-MM or Present)')} placeholder={t('resume.end', 'End (YYYY-MM or Present)')} {...register(`experience.${index}.endDate`)} />
              </div>
              <Remove label={t('resume.removeRole', 'Remove role')} onClick={() => experience.remove(index)} />
            </div>
            <TextArea aria-label={t('resume.bullets', 'Bullets (one per line)')} rows={4} {...register(`experience.${index}.bullets`)} />
            {Object.entries(highlight)
              .filter(([path]) => path.startsWith(`experience[${index}].bullets`))
              .map(([path, reason]) => (
                <p key={path} className="text-xs font-medium text-red-600">
                  ⚠ {reason}
                </p>
              ))}
          </div>
        ))}
      </Section>

      <Section title={t('resume.skills', 'Skills')}>
        <TextArea aria-label={t('resume.skillsHint', 'Skills (comma separated)')} rows={3} {...register('skills')} />
        {Object.entries(highlight)
          .filter(([path]) => path.startsWith('skills'))
          .map(([path, reason]) => (
            <p key={path} className="text-xs font-medium text-red-600">
              ⚠ {reason}
            </p>
          ))}
      </Section>

      <Section title={t('resume.projects', 'Projects')} onAdd={() => projects.append(EMPTY.projects)} addLabel={t('resume.addProject', 'Add project')}>
        {projects.fields.map((project, index) => (
          <div key={project.id} className="space-y-2 rounded-md bg-slate-50 p-3">
            {flag(`projects[${index}]`)}
            <div className="flex gap-2">
              <Input aria-label={t('resume.projectName', 'Project name')} placeholder={t('resume.projectName', 'Project name')} {...register(`projects.${index}.name`)} />
              <Remove label={t('resume.removeProject', 'Remove project')} onClick={() => projects.remove(index)} />
            </div>
            <Input aria-label={t('resume.projectDescription', 'Description')} placeholder={t('resume.projectDescription', 'Description')} {...register(`projects.${index}.description`)} />
            <TextArea aria-label={t('resume.bullets', 'Bullets (one per line)')} rows={3} {...register(`projects.${index}.bullets`)} />
          </div>
        ))}
      </Section>

      <Section title={t('resume.education', 'Education')} onAdd={() => education.append(EMPTY.education)} addLabel={t('resume.addEducation', 'Add education')}>
        {education.fields.map((entry, index) => (
          <div key={entry.id} className="flex gap-2">
            <div className="grid flex-1 gap-2 sm:grid-cols-3">
              {flag(`education[${index}]`)}
              <Input aria-label={t('resume.institution', 'Institution')} placeholder={t('resume.institution', 'Institution')} {...register(`education.${index}.institution`)} />
              <Input aria-label={t('resume.degree', 'Degree')} placeholder={t('resume.degree', 'Degree')} {...register(`education.${index}.degree`)} />
              <Input aria-label={t('resume.field', 'Field')} placeholder={t('resume.field', 'Field')} {...register(`education.${index}.field`)} />
              <Input aria-label={t('resume.start', 'Start')} placeholder={t('resume.start', 'Start')} {...register(`education.${index}.startDate`)} />
              <Input aria-label={t('resume.end', 'End')} placeholder={t('resume.end', 'End')} {...register(`education.${index}.endDate`)} />
            </div>
            <Remove label={t('resume.removeEducation', 'Remove education')} onClick={() => education.remove(index)} />
          </div>
        ))}
      </Section>

      <Section title={t('resume.certifications', 'Certifications')} onAdd={() => certifications.append(EMPTY.certifications)} addLabel={t('resume.addCertification', 'Add certification')}>
        {certifications.fields.map((cert, index) => (
          <div key={cert.id} className="flex gap-2">
            <div className="grid flex-1 gap-2 sm:grid-cols-3">
              {flag(`certifications[${index}]`)}
              <Input aria-label={t('resume.certName', 'Certification')} placeholder={t('resume.certName', 'Certification')} {...register(`certifications.${index}.name`)} />
              <Input aria-label={t('resume.issuer', 'Issuer')} placeholder={t('resume.issuer', 'Issuer')} {...register(`certifications.${index}.issuer`)} />
              <Input aria-label={t('resume.date', 'Date')} placeholder={t('resume.date', 'Date')} {...register(`certifications.${index}.date`)} />
            </div>
            <Remove label={t('resume.removeCertification', 'Remove certification')} onClick={() => certifications.remove(index)} />
          </div>
        ))}
      </Section>

      </fieldset>
      {!readOnly && (
        <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-white/95 py-3 backdrop-blur">
          {extraActions}
          <Button type="submit" loading={saving}>
            {saveLabel ?? t('common.save', 'Save')}
          </Button>
        </div>
      )}
    </form>
  );
}
