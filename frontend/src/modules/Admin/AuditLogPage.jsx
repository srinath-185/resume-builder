import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useListAuditLogsQuery } from '@/app/api/admin';
import { DataTable } from '@/common/components/DataTable';
import { ErrorMessage, Input, PageHeader, Spinner } from '@/common/components/ui';
import { Pager } from './Pager';

const PAGE_SIZE = 50;

function summary(entry) {
  const parts = [entry.before && `before ${JSON.stringify(entry.before)}`, entry.after && `after ${JSON.stringify(entry.after)}`, entry.meta && JSON.stringify(entry.meta)];
  return parts.filter(Boolean).join(' · ');
}

export default function AuditLogPage() {
  const { t } = useTranslation();
  const [userId, setUserId] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const filter = setter => event => {
    setter(event.target.value);
    setPage(1);
  };
  const { data, isLoading, error } = useListAuditLogsQuery({ userId: userId.trim() || undefined, action: action.trim().toUpperCase() || undefined, page, limit: PAGE_SIZE });

  return (
    <div>
      <PageHeader title={t('admin.audit.title', 'Audit log')} description={t('admin.audit.description', 'Every change made through the API, newest first. Secrets are redacted before they are written.')} />
      <div className="mb-4 grid gap-2 sm:grid-cols-2">
        <Input aria-label={t('admin.audit.userId', 'User id')} placeholder={t('admin.audit.userId', 'User id')} value={userId} onChange={filter(setUserId)} />
        <Input aria-label={t('admin.audit.action', 'Action')} placeholder={t('admin.audit.actionHint', 'Action, e.g. ADMIN_USER_DISABLED')} value={action} onChange={filter(setAction)} />
      </div>
      <div className="space-y-4">
        <ErrorMessage error={error} />
        {isLoading ? (
          <Spinner />
        ) : (
          <DataTable
            rows={data?.items}
            empty={t('admin.audit.empty', 'No entries.')}
            columns={[
              { key: 'createdAt', header: t('admin.audit.when', 'When'), render: entry => new Date(entry.createdAt).toLocaleString(), className: 'whitespace-nowrap' },
              { key: 'action', header: t('admin.audit.action', 'Action'), render: entry => <code className="text-xs">{entry.action}</code> },
              { key: 'userId', header: t('admin.audit.actor', 'By user'), render: entry => <span className="text-xs">{entry.userId ?? 'system'}</span> },
              { key: 'entity', header: t('admin.audit.entity', 'Entity'), render: entry => <span className="text-xs">{[entry.entity, entry.entityId].filter(Boolean).join(' ')}</span> },
              { key: 'details', header: t('admin.audit.details', 'Details'), render: entry => <span className="break-all text-xs text-slate-500">{summary(entry)}</span> },
            ]}
          />
        )}
        {data && <Pager page={page} total={data.total} pageSize={PAGE_SIZE} onChange={setPage} />}
      </div>
    </div>
  );
}
