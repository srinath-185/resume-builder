import { Star, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { PARSE_IN_FLIGHT, useDeleteResumeMutation, useListResumesQuery, useSetPrimaryResumeMutation, useUploadResumeMutation } from '@/app/api/resumes';
import { DataTable } from '@/common/components/DataTable';
import { StatusBadge } from '@/common/components/StatusBadge';
import { Alert, Badge, Button, ErrorMessage, Modal, PageHeader, Spinner } from '@/common/components/ui';

const ACCEPT = '.pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain';

export default function ResumesPage() {
  const { t } = useTranslation();
  const [polling, setPolling] = useState(0);
  const { data: resumes, isLoading, error } = useListResumesQuery(undefined, { pollingInterval: polling });
  const [upload, uploadState] = useUploadResumeMutation();
  const [setPrimary] = useSetPrimaryResumeMutation();
  const [remove, removeState] = useDeleteResumeMutation();
  const [deleting, setDeleting] = useState(null);
  const input = useRef(null);

  const inFlight = (resumes ?? []).some(resume => PARSE_IN_FLIGHT.includes(resume.parseStatus));
  useEffect(() => setPolling(inFlight ? 2500 : 0), [inFlight]);

  const onFile = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) await upload(file);
  };

  return (
    <div>
      <PageHeader
        title={t('resumes.title', 'Resumes')}
        description={t('resumes.description', 'Upload your master resume. It is read once into structured sections you can correct; tailored versions never change it.')}
        actions={
          <>
            <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={onFile} aria-label={t('resumes.chooseFile', 'Choose resume file')} />
            <Button icon={Upload} loading={uploadState.isLoading} onClick={() => input.current?.click()}>
              {t('resumes.upload', 'Upload resume')}
            </Button>
          </>
        }
      />
      <div className="space-y-3">
        <ErrorMessage error={uploadState.error ?? error} />
        {inFlight && <Alert>{t('resumes.parsing', 'Reading your resume with the AI model… this usually takes under a minute.')}</Alert>}
        {isLoading ? (
          <Spinner />
        ) : (
          <DataTable
            rows={resumes}
            empty={t('resumes.empty', 'No resumes yet. Upload a PDF, DOCX or TXT to get started.')}
            columns={[
              {
                key: 'fileName',
                header: t('resumes.file', 'File'),
                render: resume => (
                  <Link to={`/resumes/${resume.id}`} className="font-medium text-brand-700 hover:underline">
                    {resume.fileName}
                  </Link>
                ),
              },
              {
                key: 'parseStatus',
                header: t('resumes.status', 'Status'),
                render: resume => (
                  <div className="space-y-1">
                    <StatusBadge status={resume.parseStatus} />
                    {resume.parseError && <p className="text-xs text-red-600">{resume.parseError}</p>}
                  </div>
                ),
              },
              { key: 'isPrimary', header: t('resumes.primary', 'Primary'), render: resume => (resume.isPrimary ? <Badge tone="green">{t('resumes.primary', 'Primary')}</Badge> : null) },
              { key: 'userEdited', header: t('resumes.edited', 'Corrected'), render: resume => (resume.userEdited ? t('common.yes', 'Yes') : '') },
              { key: 'createdAt', header: t('resumes.uploaded', 'Uploaded'), render: resume => new Date(resume.createdAt).toLocaleString() },
              {
                key: 'actions',
                header: '',
                className: 'text-right whitespace-nowrap',
                render: resume => (
                  <div className="flex justify-end gap-1">
                    {!resume.isPrimary && (
                      <Button variant="ghost" icon={Star} onClick={() => setPrimary(resume.id)}>
                        {t('resumes.makePrimary', 'Make primary')}
                      </Button>
                    )}
                    <Button variant="ghost" icon={Trash2} aria-label={t('common.delete', 'Delete')} onClick={() => setDeleting(resume)} />
                  </div>
                ),
              },
            ]}
          />
        )}
      </div>
      <Modal
        open={Boolean(deleting)}
        title={t('resumes.deleteTitle', 'Delete this resume?')}
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              variant="danger"
              loading={removeState.isLoading}
              onClick={async () => {
                if (!(await remove(deleting.id)).error) setDeleting(null);
              }}
            >
              {t('common.delete', 'Delete')}
            </Button>
          </>
        }
      >
        <ErrorMessage error={removeState.error} />
        <p className="text-sm text-slate-600">{deleting?.fileName}</p>
      </Modal>
    </div>
  );
}
