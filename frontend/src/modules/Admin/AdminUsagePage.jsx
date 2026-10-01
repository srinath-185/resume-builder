import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminLlmUsageQuery } from '@/app/api/admin';
import { DataTable } from '@/common/components/DataTable';
import { Card, ErrorMessage, PageHeader, Select, Spinner } from '@/common/components/ui';

const tokens = row => `${row.inputTokens.toLocaleString()} / ${row.outputTokens.toLocaleString()}`;

export default function AdminUsagePage() {
  const { t } = useTranslation();
  const [days, setDays] = useState(1);
  const { data, isLoading, error } = useAdminLlmUsageQuery(days);

  return (
    <div>
      <PageHeader
        title={t('admin.usage.title', 'AI usage (all users)')}
        description={t('admin.usage.description', 'Free-tier quotas are shared by everyone on this server. See who is using them.')}
        actions={
          <Select aria-label={t('admin.usage.period', 'Period')} value={days} onChange={event => setDays(Number(event.target.value))}>
            <option value={1}>{t('admin.usage.today', 'Today (UTC)')}</option>
            <option value={7}>{t('admin.usage.week', 'Last 7 days')}</option>
            <option value={30}>{t('admin.usage.month', 'Last 30 days')}</option>
          </Select>
        }
      />
      <ErrorMessage error={error} />
      {isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <Card title={t('admin.usage.byProvider', 'By provider')}>
            <DataTable
              rows={data?.byProvider}
              rowKey={row => row.provider}
              empty={t('admin.usage.none', 'No AI calls in this period.')}
              columns={[
                { key: 'provider', header: t('ai.provider', 'Provider'), render: row => <span className="capitalize">{row.provider}</span> },
                { key: 'calls', header: t('ai.calls', 'Calls') },
                { key: 'failures', header: t('ai.failures', 'Failures') },
                { key: 'tokens', header: t('ai.tokensUsed', 'Tokens in / out'), render: tokens },
              ]}
            />
          </Card>
          <Card title={t('admin.usage.byUser', 'Top users')}>
            <DataTable
              rows={data?.byUser}
              rowKey={row => row.userId}
              empty={t('admin.usage.none', 'No AI calls in this period.')}
              columns={[
                { key: 'email', header: t('admin.usage.user', 'User'), render: row => row.email ?? row.userId },
                { key: 'calls', header: t('ai.calls', 'Calls') },
                { key: 'failures', header: t('ai.failures', 'Failures') },
                { key: 'tokens', header: t('ai.tokensUsed', 'Tokens in / out'), render: tokens },
              ]}
            />
          </Card>
        </div>
      )}
    </div>
  );
}
