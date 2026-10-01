import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { BUSY_STATUSES, useEditVariantMutation, useGetApplicationQuery } from '@/app/api/applications';
import { StatusBadge } from '@/common/components/StatusBadge';
import { Alert, Card, ErrorMessage, PageHeader, Spinner, Tabs } from '@/common/components/ui';
import { useAuthorizedFile } from '@/common/hooks/useAuthorizedFile';
import { ResumeDocumentEditor } from '@/common/resume/ResumeDocumentEditor';
import { ApplicationActions } from './ApplicationActions';
import { ChangesList, CoverageCard, FactCheckCard, NoteAndAnswersForm, violationHighlights } from './ReviewPanels';

function Pdf({ path, version, title }) {
  const { url, loading } = useAuthorizedFile(path, version);
  if (loading) return <Spinner />;
  return url ? <iframe title={title} src={url} className="h-[75vh] w-full rounded-md ring-1 ring-slate-200" /> : null;
}

function Screenshot({ id, version }) {
  const { t } = useTranslation();
  const { url } = useAuthorizedFile(`/applications/${id}/screenshot.png`, version);
  return url ? (
    <details className="rounded-md ring-1 ring-slate-200">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{t('review.screenshot', 'What the browser saw')}</summary>
      <img src={url} alt={t('review.screenshot', 'What the browser saw')} className="max-h-[70vh] w-full object-contain" />
    </details>
  ) : null;
}

/**
 * The review gate. Shows exactly what changed from the master resume and why,
 * the job's keyword coverage and the fact-check, lets the user edit, and only
 * then offers Approve. Applying and emailing become possible after approval.
 */
export default function ApplicationReviewPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [polling, setPolling] = useState(0);
  const { data: review, isLoading, error } = useGetApplicationQuery(id, { pollingInterval: polling });
  const [edit, editState] = useEditVariantMutation();
  const [tab, setTab] = useState('changes');

  const status = review?.application.status;
  const busy = Boolean(status && BUSY_STATUSES.includes(status));
  useEffect(() => setPolling(busy ? 2500 : 0), [busy]);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorMessage error={error} />;

  const { application, listing, variant, master } = review;
  const editable = status === 'REVIEW_PENDING';
  const version = `${application.updatedAt}`;

  return (
    <div>
      <Link to="/applications" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="size-4" aria-hidden /> {t('applications.back', 'All applications')}
      </Link>
      <PageHeader
        title={`${listing.title} — ${listing.company}`}
        description={listing.location}
        actions={<StatusBadge status={status} />}
      />

      <div className="space-y-4">
        {status === 'TAILORING' && <Alert>{t('review.tailoring', 'Drafting a tailored resume… the review appears here when it is ready.')}</Alert>}
        {status === 'APPLYING' && <Alert>{t('review.applying', 'Applying in a headless browser with your approved resume…')}</Alert>}
        {status === 'APPLIED' && <Alert tone="green" title={t('review.applied', 'Applied')}>{application.appliedAt && new Date(application.appliedAt).toLocaleString()}</Alert>}
        {['TAILOR_FAILED', 'NEEDS_REVIEW', 'FAILED'].includes(status) && application.lastError && (
          <Alert tone={status === 'NEEDS_REVIEW' ? 'amber' : 'red'} title={status === 'NEEDS_REVIEW' ? t('review.needsYou', 'This needs you') : t('review.failed', 'Something went wrong')}>
            <p className="whitespace-pre-line">{application.lastError}</p>
          </Alert>
        )}
        {['NEEDS_REVIEW', 'FAILED', 'APPLIED'].includes(status) && application.method && application.method !== 'MANUAL' && <Screenshot id={application.id} version={version} />}

        <ApplicationActions review={review} />

        {variant && (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <FactCheckCard factCheck={variant.factCheck} />
              <CoverageCard coverage={variant.keywordCoverage} />
            </div>
            <Tabs
              tabs={[
                { id: 'changes', label: t('review.tabChanges', 'What changed'), count: variant.changes.length },
                { id: 'edit', label: editable ? t('review.tabEdit', 'Edit tailored resume') : t('review.tabResume', 'Tailored resume') },
                { id: 'compare', label: t('review.tabCompare', 'Side by side') },
                { id: 'note', label: t('review.tabNote', 'Cover note & answers') },
                { id: 'job', label: t('review.tabJob', 'Job description') },
              ]}
              active={tab}
              onChange={setTab}
            />
            <ErrorMessage error={editState.error} />
            {tab === 'changes' && <ChangesList changes={variant.changes} />}
            {tab === 'edit' && (
              <Card>
                <ResumeDocumentEditor
                  key={`${variant.id}-${variant.updatedAt}`}
                  document={variant.document}
                  highlight={violationHighlights(variant.factCheck.violations, t)}
                  saving={editState.isLoading}
                  readOnly={!editable}
                  saveLabel={t('review.saveRecheck', 'Save and re-check')}
                  onSave={document => edit({ id: application.id, document })}
                />
              </Card>
            )}
            {tab === 'compare' && (
              <div className="grid gap-4 xl:grid-cols-2">
                <Card title={t('review.master', 'Master resume')}>{master ? <Pdf path={`/resumes/${master.resumeId}/pdf?template=${variant.templateId}`} title={t('review.master', 'Master resume')} /> : null}</Card>
                <Card title={t('review.tailored', 'Tailored for this job')}>
                  <Pdf path={`/applications/${application.id}/resume.pdf`} version={variant.updatedAt} title={t('review.tailored', 'Tailored for this job')} />
                </Card>
              </div>
            )}
            {tab === 'note' && (
              <Card>
                <NoteAndAnswersForm key={variant.updatedAt} variant={editable ? variant : { ...variant, coverNote: application.approvedCoverNote ?? variant.coverNote, formAnswers: application.approvedFormAnswers?.length ? application.approvedFormAnswers : variant.formAnswers }} editable={editable} saving={editState.isLoading} onSave={body => edit({ id: application.id, ...body })} />
              </Card>
            )}
            {tab === 'job' && <Card><div className="whitespace-pre-line text-sm text-slate-700">{listing.description}</div></Card>}
            {variant.generatedBy && (
              <p className="text-xs text-slate-500">
                {t('review.generatedBy', 'Version {{generation}} drafted by {{provider}} / {{model}}', { generation: variant.generation, ...variant.generatedBy })}
                {variant.instructions ? ` · “${variant.instructions}”` : ''}
                {variant.userEdited ? ` · ${t('review.editedByYou', 'edited by you')}` : ''}
              </p>
            )}
          </>
        )}

        {application.history?.length > 0 && (
          <Card title={t('review.history', 'History')}>
            <ol className="space-y-1 text-xs text-slate-600">
              {application.history.map((entry, index) => (
                <li key={index}>
                  {new Date(entry.at).toLocaleString()} — {entry.from} → <strong>{entry.to}</strong>
                  {entry.note ? ` · ${entry.note.split('\n')[0]}` : ''}
                </li>
              ))}
            </ol>
          </Card>
        )}
      </div>
    </div>
  );
}
