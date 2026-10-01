import { useFieldArray, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Field, TextArea } from '@/common/components/ui';

const VIOLATION_TEXT = {
  unknown_role: 'Role not in your resume',
  changed_dates: 'Dates differ from your resume',
  unknown_education: 'Education not in your resume',
  unknown_certification: 'Certification not in your resume',
  unknown_project: 'Project not in your resume',
  changed_contact: 'Contact detail changed',
  unsupported_skill: 'Skill not mentioned in your resume',
  new_number: 'Number not in your resume',
};

export function violationText(violation, t) {
  return `${t(`review.violation.${violation.kind}`, VIOLATION_TEXT[violation.kind] ?? violation.kind)}: “${violation.value}”`;
}

/** path → message, for highlighting in the editor. */
export function violationHighlights(violations, t) {
  const map = {};
  for (const violation of violations ?? []) {
    const path = violation.path.replace(/\.bullets\[\d+\]$/, '.bullets');
    map[path] = map[path] ? `${map[path]}; ${violationText(violation, t)}` : violationText(violation, t);
  }
  return map;
}

export function CoverageCard({ coverage }) {
  const { t } = useTranslation();
  if (!coverage || coverage.keywords.length === 0) return null;
  return (
    <Card title={t('review.coverage', 'Job keyword coverage')}>
      <div className="flex items-center gap-3 text-sm">
        <span className="text-slate-600">{t('review.before', 'Master')}</span>
        <div className="h-2 flex-1 rounded bg-slate-100">
          <div className="h-2 rounded bg-slate-400" style={{ width: `${coverage.before}%` }} />
        </div>
        <span className="w-10 text-right font-medium">{coverage.before}%</span>
      </div>
      <div className="mt-2 flex items-center gap-3 text-sm">
        <span className="text-slate-600">{t('review.after', 'Tailored')}</span>
        <div className="h-2 flex-1 rounded bg-slate-100">
          <div className="h-2 rounded bg-brand-600" style={{ width: `${coverage.after}%` }} />
        </div>
        <span className="w-10 text-right font-medium">{coverage.after}%</span>
      </div>
      {coverage.missing.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold uppercase text-slate-500">{t('review.gaps', 'Still missing (left visible on purpose)')}</p>
          <div className="flex flex-wrap gap-1">{coverage.missing.map(keyword => <Badge key={keyword} tone="amber">{keyword}</Badge>)}</div>
        </div>
      )}
    </Card>
  );
}

export function FactCheckCard({ factCheck }) {
  const { t } = useTranslation();
  if (!factCheck) return null;
  if (factCheck.passed) return <Alert tone="green" title={t('review.factOk', 'Fact-check passed')}>{t('review.factOkHint', 'Every employer, date, skill and number appears in your master resume.')}</Alert>;
  return (
    <Alert tone="red" title={t('review.factFailed', 'Fix these before approving')}>
      <ul className="list-disc space-y-0.5 pl-5">
        {factCheck.violations.map((violation, index) => (
          <li key={index}>
            <code className="text-xs">{violation.path}</code> — {violationText(violation, t)}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs">{t('review.factHint', 'If the fact is true, add it to your master resume first; tailored versions may only reuse what is there.')}</p>
    </Alert>
  );
}

export function ChangesList({ changes }) {
  const { t } = useTranslation();
  if (!changes?.length) return <p className="text-sm text-slate-600">{t('review.noChanges', 'No changes from your master resume.')}</p>;
  return (
    <ol className="space-y-3">
      {changes.map((change, index) => (
        <li key={index} className="rounded-md ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-1.5">
            <code className="text-xs text-slate-700">{change.path}</code>
            {change.reason && <span className="text-xs text-slate-600">{change.reason}</span>}
          </div>
          <div className="grid gap-px bg-slate-100 sm:grid-cols-2">
            <div className="whitespace-pre-line bg-red-50/60 p-3 text-xs text-slate-700">
              <p className="mb-1 font-semibold text-red-700">{t('review.was', 'Master')}</p>
              {change.before ?? <em>{t('review.none', '(none)')}</em>}
            </div>
            <div className="whitespace-pre-line bg-emerald-50/60 p-3 text-xs text-slate-700">
              <p className="mb-1 font-semibold text-emerald-700">{t('review.now', 'Tailored')}</p>
              {change.after ?? <em>{t('review.removed', '(removed)')}</em>}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Cover note and screening answers, editable while the draft is under review. */
export function NoteAndAnswersForm({ variant, editable, onSave, saving }) {
  const { t } = useTranslation();
  const { register, control, handleSubmit } = useForm({ defaultValues: { coverNote: variant.coverNote ?? '', formAnswers: variant.formAnswers ?? [] } });
  const answers = useFieldArray({ control, name: 'formAnswers' });
  return (
    <form onSubmit={handleSubmit(values => onSave({ coverNote: values.coverNote, formAnswers: values.formAnswers.filter(answer => answer.question.trim() && answer.answer.trim()) }))} className="space-y-4">
      <Field label={t('review.coverNote', 'Cover note')} htmlFor="coverNote">
        <TextArea id="coverNote" rows={7} disabled={!editable} {...register('coverNote')} />
      </Field>
      <div className="space-y-3">
        <p className="text-sm font-medium text-slate-700">{t('review.answers', 'Screening answers used when applying')}</p>
        {answers.fields.map((answer, index) => (
          <div key={answer.id} className="space-y-1 rounded-md bg-slate-50 p-3">
            <TextArea aria-label={t('review.question', 'Question')} rows={1} disabled={!editable} {...register(`formAnswers.${index}.question`)} />
            <TextArea aria-label={t('review.answer', 'Answer')} rows={2} disabled={!editable} {...register(`formAnswers.${index}.answer`)} />
            {editable && (
              <Button variant="ghost" onClick={() => answers.remove(index)}>
                {t('common.remove', 'Remove')}
              </Button>
            )}
          </div>
        ))}
        {editable && (
          <Button variant="secondary" onClick={() => answers.append({ question: '', answer: '' })}>
            {t('review.addAnswer', 'Add answer')}
          </Button>
        )}
      </div>
      {editable && (
        <div className="flex justify-end">
          <Button type="submit" loading={saving}>
            {t('common.save', 'Save')}
          </Button>
        </div>
      )}
    </form>
  );
}
