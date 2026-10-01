import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLlmStatusQuery } from '@/app/api/auth';
import { selectUser } from '@/app/authSlice';
import { DASHBOARD_WIDGETS } from '@/app/dashboardWidgets';
import { Alert, Badge, Card, PageHeader, Spinner } from '@/common/components/ui';

function AiProviders() {
  const { t } = useTranslation();
  const { data, isLoading } = useLlmStatusQuery();
  if (isLoading) return <Spinner />;
  const providers = data?.providers ?? [];
  const configured = providers.filter(provider => provider.configured);
  return (
    <Card title={t('dashboard.ai', 'AI providers (free tiers first)')}>
      {configured.length === 0 && <Alert tone="amber">{t('dashboard.noAi', 'No AI provider is configured. Add a free GROQ_API_KEY or GEMINI_API_KEY to the server.')}</Alert>}
      <ul className="divide-y divide-slate-100">
        {providers.map(provider => {
          const pct = provider.tokensPerDay ? Math.min(100, Math.round((100 * provider.tokensToday) / provider.tokensPerDay)) : null;
          return (
            <li key={provider.provider} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="font-medium capitalize">{provider.provider}</span>
              <span className="flex items-center gap-2 text-slate-600">
                {provider.configured ? <Badge tone="green">{t('dashboard.configured', 'configured')}</Badge> : <Badge>{t('dashboard.off', 'off')}</Badge>}
                {provider.coolingDownUntil && <Badge tone="amber">{t('dashboard.coolingDown', 'cooling down')}</Badge>}
                {pct !== null && provider.configured && <span>{t('dashboard.tokensUsed', '{{pct}}% of daily tokens', { pct })}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const user = useSelector(selectUser);
  return (
    <div>
      <PageHeader
        title={t('dashboard.title', 'Welcome, {{name}}', { name: user?.name ?? '' })}
        description={t('dashboard.description', 'Upload your resume, review tailored versions for matching jobs, and approve before anything is sent.')}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {DASHBOARD_WIDGETS.map((Widget, index) => (
          <Widget key={index} />
        ))}
        <AiProviders />
      </div>
    </div>
  );
}
