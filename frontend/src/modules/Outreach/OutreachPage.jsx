import { PenSquare } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useListOutreachQuery } from '@/app/api/outreach';
import { DataTable } from '@/common/components/DataTable';
import { StatusBadge } from '@/common/components/StatusBadge';
import { Button, ErrorMessage, PageHeader, Spinner, Tabs } from '@/common/components/ui';
import { OutreachEditor } from './OutreachEditor';

export default function OutreachPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState('DRAFT');
  const { data, isLoading, error } = useListOutreachQuery(status || undefined, { pollingInterval: 5000 });
  const open = params.get('open');

  return (
    <div>
      <PageHeader
        title={t('outreach.title', 'Outbox')}
        description={t('outreach.description', 'Drafts wait for you. Follow-ups are drafted automatically after a few days, never sent on their own.')}
        actions={
          <Button icon={PenSquare} onClick={() => navigate('/outreach/new')}>
            {t('outreach.new', 'New email')}
          </Button>
        }
      />
      <Tabs
        tabs={[
          { id: 'DRAFT', label: t('outreach.drafts', 'Drafts') },
          { id: 'SENT', label: t('outreach.sent', 'Sent') },
          { id: 'FAILED', label: t('outreach.failed', 'Failed') },
          { id: '', label: t('outreach.all', 'All') },
        ]}
        active={status}
        onChange={setStatus}
      />
      <ErrorMessage error={error} />
      {isLoading ? (
        <Spinner />
      ) : (
        <DataTable
          rows={data}
          onRowClick={message => setParams({ open: message.id })}
          empty={t('outreach.empty', 'No emails here.')}
          columns={[
            { key: 'status', header: t('outreach.status', 'Status'), render: message => <StatusBadge status={message.status} /> },
            { key: 'toEmail', header: t('outreach.recipient', 'To') },
            { key: 'subject', header: t('outreach.subject', 'Subject'), render: message => <span className="line-clamp-1">{message.subject}</span> },
            { key: 'sequence', header: '', render: message => (message.sequence === 2 ? t('outreach.followUp', 'Follow-up') : '') },
            { key: 'when', header: t('outreach.when', 'When'), render: message => new Date(message.sentAt ?? message.createdAt).toLocaleString() },
          ]}
        />
      )}
      {open && <OutreachEditor id={open} onClose={() => setParams({})} />}
    </div>
  );
}
