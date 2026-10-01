import { useTranslation } from 'react-i18next';
import { useLlmStatusQuery } from '@/app/api/auth';
import { DataTable } from '@/common/components/DataTable';
import { Badge, Card, ErrorMessage, PageHeader, Spinner } from '@/common/components/ui';

export default function AiUsagePage() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useLlmStatusQuery(undefined, { pollingInterval: 15000 });
  if (isLoading) return <Spinner />;
  return (
    <div>
      <PageHeader title={t('ai.title', 'AI usage')} description={t('ai.description', 'Free tiers first. When one provider’s daily budget is used up, the next one takes over.')} />
      <ErrorMessage error={error} />
      <div className="space-y-4">
        <DataTable
          rows={data?.providers}
          rowKey={row => row.provider}
          columns={[
            { key: 'provider', header: t('ai.provider', 'Provider'), render: row => <span className="font-medium capitalize">{row.provider}</span> },
            { key: 'configured', header: '', render: row => (row.configured ? <Badge tone="green">{t('ai.on', 'configured')}</Badge> : <Badge>{t('ai.off', 'off')}</Badge>) },
            { key: 'models', header: t('ai.models', 'Models (small / large)'), render: row => <span className="text-xs">{[row.models.small, row.models.large].filter(Boolean).join(' / ') || '—'}</span> },
            { key: 'rpm', header: t('ai.rpm', 'Requests this minute'), render: row => `${row.requestsThisMinute}${row.rpm ? ` / ${row.rpm}` : ''}` },
            { key: 'tokens', header: t('ai.tokens', 'Tokens today'), render: row => `${row.tokensToday.toLocaleString()}${row.tokensPerDay ? ` / ${row.tokensPerDay.toLocaleString()}` : ''}` },
            { key: 'cool', header: '', render: row => (row.coolingDownUntil ? <Badge tone="amber">{t('ai.cooling', 'rate limited')}</Badge> : null) },
          ]}
        />
        <Card title={t('ai.routes', 'Provider order per task')}>
          <ul className="space-y-1 text-sm">
            {Object.entries(data?.routes ?? {}).map(([task, chain]) => (
              <li key={task}>
                <code className="text-xs">{task}</code> → {chain.join(' → ')}
              </li>
            ))}
          </ul>
        </Card>
        <DataTable
          rows={data?.usageToday}
          rowKey={row => `${row.provider}-${row.task}`}
          empty={t('ai.noUsage', 'No AI calls today.')}
          columns={[
            { key: 'task', header: t('ai.task', 'Task') },
            { key: 'provider', header: t('ai.provider', 'Provider') },
            { key: 'calls', header: t('ai.calls', 'Calls') },
            { key: 'failures', header: t('ai.failures', 'Failures') },
            { key: 'tokens', header: t('ai.tokensUsed', 'Tokens in / out'), render: row => `${row.inputTokens} / ${row.outputTokens}` },
          ]}
        />
      </div>
    </div>
  );
}
