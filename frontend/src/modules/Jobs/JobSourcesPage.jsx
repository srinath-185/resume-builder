import { useTranslation } from 'react-i18next';
import { useListJobSourcesQuery, useSetJobSourceMutation } from '@/app/api/jobs';
import { Alert, Badge, Card, ErrorMessage, PageHeader, Spinner } from '@/common/components/ui';

export function SourceList({ sources, onToggle, pending }) {
  const { t } = useTranslation();
  return (
    <ul className="divide-y divide-slate-100">
      {sources.map(source => (
        <li key={source.key} className="flex flex-wrap items-start justify-between gap-3 py-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {source.label}
              {source.official ? <Badge tone="green">{t('sources.official', 'official API')}</Badge> : <Badge tone="amber">{t('sources.unofficial', 'unofficial scraper')}</Badge>}
              {!source.configured && <Badge>{t('sources.notConfigured', 'not configured on server')}</Badge>}
            </p>
            <p className="mt-0.5 text-xs text-slate-600">{source.description}</p>
            {source.lastRunAt && (
              <p className="mt-0.5 text-xs text-slate-500">
                {t('sources.lastRun', 'Last run {{when}} · {{count}} found', { when: new Date(source.lastRunAt).toLocaleString(), count: source.lastFound ?? 0 })}
              </p>
            )}
            {source.lastError && <p className="mt-0.5 text-xs text-red-600">{source.lastError}</p>}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={source.enabled} disabled={!source.configured || pending} onChange={event => onToggle(source.key, event.target.checked)} aria-label={t('sources.toggle', 'Use {{name}}', { name: source.label })} />
            {source.enabled ? t('sources.on', 'On') : t('sources.off', 'Off')}
          </label>
        </li>
      ))}
    </ul>
  );
}

export default function JobSourcesPage() {
  const { t } = useTranslation();
  const { data: sources, isLoading, error } = useListJobSourcesQuery();
  const [setSource, state] = useSetJobSourceMutation();
  return (
    <div>
      <PageHeader title={t('sources.title', 'Job sources')} description={t('sources.description', 'Where discovery searches. Official APIs are on by default; scrapers stay off until you choose them.')} />
      <Alert tone="amber">
        {t('sources.warning', 'Scraping LinkedIn or Naukri can break their terms of service and may stop working at any time. JSearch already includes many LinkedIn, Indeed and Naukri listings through Google for Jobs.')}
      </Alert>
      <div className="mt-4">
        <ErrorMessage error={state.error ?? error} />
        <Card>{isLoading ? <Spinner /> : <SourceList sources={sources ?? []} pending={state.isLoading} onToggle={(key, enabled) => setSource({ key, enabled })} />}</Card>
      </div>
    </div>
  );
}
