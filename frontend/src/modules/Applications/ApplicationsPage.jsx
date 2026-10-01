import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { BUSY_STATUSES, useListApplicationsQuery } from '@/app/api/applications';
import { DataTable } from '@/common/components/DataTable';
import { StatusBadge } from '@/common/components/StatusBadge';
import { ErrorMessage, PageHeader, Spinner, Tabs } from '@/common/components/ui';

export const APPLICATION_TABS = [
  { id: 'REVIEW_PENDING', label: 'To review' },
  { id: 'APPROVED', label: 'Approved' },
  { id: 'NEEDS_REVIEW', label: 'Needs attention' },
  { id: 'APPLIED', label: 'Applied' },
  { id: '', label: 'All' },
];

export default function ApplicationsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [status, setStatus] = useState('REVIEW_PENDING');
  const { data, isLoading, error } = useListApplicationsQuery(status || undefined, { pollingInterval: 5000 });

  return (
    <div>
      <PageHeader
        title={t('applications.title', 'Applications')}
        description={t('applications.description', 'Every tailored resume waits here for your review. Approve to apply or email a recruiter.')}
      />
      <Tabs tabs={APPLICATION_TABS.map(tab => ({ ...tab, label: t(`applications.tab.${tab.id || 'all'}`, tab.label) }))} active={status} onChange={setStatus} />
      <ErrorMessage error={error} />
      {isLoading ? (
        <Spinner />
      ) : (
        <DataTable
          rows={data}
          onRowClick={application => navigate(`/applications/${application.id}`)}
          empty={t('applications.empty', 'Nothing here. Tailor a resume from the Jobs page.')}
          columns={[
            { key: 'status', header: t('applications.status', 'Status'), render: application => <StatusBadge status={application.status} /> },
            { key: 'auto', header: '', render: application => (application.autoTailored ? <span className="text-xs text-slate-500">{t('applications.auto', 'auto-drafted')}</span> : null) },
            {
              key: 'note',
              header: t('applications.latest', 'Latest'),
              render: application => {
                const last = application.history?.at(-1);
                if (BUSY_STATUSES.includes(application.status)) return <span className="text-xs text-slate-500">{t('applications.working', 'Working…')}</span>;
                return <span className="line-clamp-2 text-xs text-slate-600">{application.lastError ?? last?.note ?? ''}</span>;
              },
            },
            { key: 'updatedAt', header: t('applications.updated', 'Updated'), render: application => new Date(application.updatedAt).toLocaleString() },
          ]}
        />
      )}
    </div>
  );
}
