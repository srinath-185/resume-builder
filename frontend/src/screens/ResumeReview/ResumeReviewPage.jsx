import { ArrowLeft, Download, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { Link, useParams } from 'react-router-dom';
import { PARSE_IN_FLIGHT, useGetResumeQuery, useReparseResumeMutation, useResumeTemplatesQuery, useUpdateResumeDocumentMutation } from '@/app/api/resumes';
import { selectToken } from '@/app/authSlice';
import { StatusBadge } from '@/common/components/StatusBadge';
import { Alert, Button, Card, ErrorMessage, Modal, PageHeader, Select, Spinner, Tabs } from '@/common/components/ui';
import { downloadAuthorized, useAuthorizedFile } from '@/common/hooks/useAuthorizedFile';
import { ResumeDocumentEditor } from '@/common/resume/ResumeDocumentEditor';

function PdfFrame({ path, version, title }) {
  const { url, loading, error } = useAuthorizedFile(path, version);
  if (loading) return <Spinner />;
  if (error) return <Alert tone="red">{error.message}</Alert>;
  return url ? <iframe title={title} src={url} className="h-[75vh] w-full rounded-md ring-1 ring-slate-200" /> : null;
}

/** Hand-built screen: the parsed resume beside the original upload, corrected before anything else uses it. */
export default function ResumeReviewPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const token = useSelector(selectToken);
  const [polling, setPolling] = useState(0);
  const { data: resume, isLoading, error } = useGetResumeQuery(id, { pollingInterval: polling });
  const { data: templates } = useResumeTemplatesQuery();
  const [save, saveState] = useUpdateResumeDocumentMutation();
  const [reparse, reparseState] = useReparseResumeMutation();
  const [tab, setTab] = useState('preview');
  const [template, setTemplate] = useState('classic');
  const [confirmReparse, setConfirmReparse] = useState(false);
  const [saved, setSaved] = useState(0);

  const inFlight = Boolean(resume && PARSE_IN_FLIGHT.includes(resume.parseStatus));
  useEffect(() => setPolling(inFlight ? 2500 : 0), [inFlight]);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorMessage error={error} />;

  const isPdf = resume.mimeType === 'application/pdf';
  const doReparse = async force => {
    const result = await reparse({ id, force });
    if (result.error?.code === 'RESUME_HAS_EDITS') setConfirmReparse(true);
    else setConfirmReparse(false);
  };

  return (
    <div>
      <Link to="/resumes" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="size-4" aria-hidden /> {t('resumes.back', 'All resumes')}
      </Link>
      <PageHeader
        title={resume.fileName}
        description={t('resumes.reviewHint', 'Check every section against your original. Tailored versions are only allowed to use facts that appear here.')}
        actions={
          <>
            <StatusBadge status={resume.parseStatus} />
            <Button variant="secondary" icon={RefreshCw} loading={reparseState.isLoading} disabled={inFlight} onClick={() => doReparse(false)}>
              {t('resumes.reparse', 'Read file again')}
            </Button>
            <Button variant="secondary" icon={Download} onClick={() => downloadAuthorized(`/resumes/${id}/file`, resume.fileName, token)}>
              {t('resumes.original', 'Original')}
            </Button>
          </>
        }
      />
      <div className="space-y-3">
        {inFlight && <Alert>{t('resumes.parsing', 'Reading your resume with the AI model… this usually takes under a minute.')}</Alert>}
        {resume.parseStatus === 'FAILED' && <Alert tone="red" title={t('resumes.failed', 'Reading the resume failed')}>{resume.parseError}</Alert>}
        {resume.parsedBy && (
          <p className="text-xs text-slate-500">
            {t('resumes.parsedBy', 'Read by {{provider}} / {{model}}', resume.parsedBy)}
            {resume.userEdited ? ` · ${t('resumes.corrected', 'corrected by you')}` : ''}
          </p>
        )}
        {saveState.isSuccess && saved > 0 && <Alert tone="green">{t('resumes.saved', 'Saved. Your profile was updated where it was empty.')}</Alert>}
        <ErrorMessage error={saveState.error ?? reparseState.error} />
      </div>

      {resume.document && (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <Card title={t('resumes.parsedSections', 'Parsed sections')}>
            <ResumeDocumentEditor
              key={resume.updatedAt}
              document={resume.document}
              saving={saveState.isLoading}
              onSave={async document => {
                const result = await save({ id, document });
                if (!result.error) setSaved(count => count + 1);
              }}
            />
          </Card>
          <Card
            title={t('resumes.compare', 'Compare')}
            actions={
              tab === 'preview' && (
                <Select aria-label={t('resumes.template', 'Template')} value={template} onChange={event => setTemplate(event.target.value)} className="w-40">
                  {(templates ?? []).map(option => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </Select>
              )
            }
          >
            <Tabs
              tabs={[
                { id: 'preview', label: t('resumes.preview', 'Rendered PDF') },
                { id: 'original', label: t('resumes.originalTab', 'Original upload') },
              ]}
              active={tab}
              onChange={setTab}
            />
            {tab === 'preview' && <PdfFrame path={`/resumes/${id}/pdf?template=${template}`} version={`${resume.updatedAt}-${saved}`} title={t('resumes.preview', 'Rendered PDF')} />}
            {tab === 'original' &&
              (isPdf ? (
                <PdfFrame path={`/resumes/${id}/file`} title={t('resumes.originalTab', 'Original upload')} />
              ) : (
                <Alert>{t('resumes.noPreview', 'Only PDFs can be previewed here. Use “Original” to download the file.')}</Alert>
              ))}
          </Card>
        </div>
      )}

      <Modal
        open={confirmReparse}
        title={t('resumes.reparseTitle', 'Replace your corrections?')}
        onClose={() => setConfirmReparse(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmReparse(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button variant="danger" loading={reparseState.isLoading} onClick={() => doReparse(true)}>
              {t('resumes.reparseConfirm', 'Read again and replace')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">{t('resumes.reparseWarning', 'Reading the file again replaces the corrections you saved.')}</p>
      </Modal>
    </div>
  );
}
