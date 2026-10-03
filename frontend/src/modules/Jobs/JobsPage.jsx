import { RefreshCw, Search, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDiscoverJobsMutation, useListJobSourcesQuery, useListJobsQuery, useRescoreJobMutation, useSetJobStatusMutation } from '@/app/api/jobs';
import { DataTable } from '@/common/components/DataTable';
import { Alert, Button, ErrorMessage, Input, PageHeader, Spinner, Tabs } from '@/common/components/ui';
import { JobDetail, ScoreBadge } from './JobDetail';
import { TailorDialog } from './TailorDialog';

const PAGE_SIZE = 20;
const SEARCH_TIMEOUT_MS = 3 * 60_000;

const lastRunAt = source => (source.lastRunAt ? new Date(source.lastRunAt).getTime() : 0);
const latestRun = sources => Math.max(0, ...(sources ?? []).map(lastRunAt));

export default function JobsPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [minScore, setMinScore] = useState('');
  const [includeFiltered, setIncludeFiltered] = useState(false);
  const [page, setPage] = useState(1);
  const [openJob, setOpenJob] = useState(null);
  const [tailoring, setTailoring] = useState(null);
  // While a queued search runs: the latest source run seen before it started. Cleared once a newer run is recorded.
  const [pendingSince, setPendingSince] = useState(null);
  // Sources whose run for the finished search reported an error.
  const [failedSources, setFailedSources] = useState([]);
  const [scoring, setScoring] = useState(false);
  const searching = pendingSince !== null;

  const params = { status: status || undefined, q: search.trim() || undefined, minScore: minScore || undefined, includeFiltered, page, limit: PAGE_SIZE };
  const polling = searching || scoring;
  const { data, isLoading, isFetching, error } = useListJobsQuery(params, { pollingInterval: polling ? 4000 : 0 });
  const { data: sources } = useListJobSourcesQuery(undefined, { pollingInterval: searching ? 3000 : 0 });
  const [discover, discoverState] = useDiscoverJobsMutation();
  const [setJobStatus] = useSetJobStatusMutation();
  const [rescore] = useRescoreJobMutation();

  useEffect(() => setScoring(Boolean(data?.items?.some(job => job.matchStatus === 'PENDING'))), [data]);

  useEffect(() => {
    if (!searching || latestRun(sources) <= pendingSince) return;
    setFailedSources(sources.filter(source => lastRunAt(source) > pendingSince && source.lastError));
    setPendingSince(null);
  }, [searching, pendingSince, sources]);

  useEffect(() => {
    if (!searching) return undefined;
    const timeout = setTimeout(() => setPendingSince(null), SEARCH_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [searching]);

  const startSearch = async () => {
    const before = latestRun(sources);
    setFailedSources([]);
    const result = await discover();
    if (!result.error) setPendingSince(before);
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const actions = job => (
    <div className="flex flex-wrap justify-end gap-1">
      <Button icon={Sparkles} onClick={() => setTailoring(job)}>
        {t('jobs.tailor', 'Tailor resume')}
      </Button>
      {job.status !== 'SHORTLISTED' && (
        <Button variant="secondary" onClick={() => setJobStatus({ id: job.id, status: 'SHORTLISTED' })}>
          {t('jobs.shortlist', 'Shortlist')}
        </Button>
      )}
      {job.status !== 'SKIPPED' && (
        <Button variant="ghost" onClick={() => setJobStatus({ id: job.id, status: 'SKIPPED' })}>
          {t('jobs.skip', 'Skip')}
        </Button>
      )}
      {job.matchStatus === 'FAILED' && (
        <Button variant="ghost" icon={RefreshCw} onClick={() => rescore(job.id)}>
          {t('jobs.rescore', 'Score again')}
        </Button>
      )}
    </div>
  );

  return (
    <div>
      <PageHeader
        title={t('jobs.title', 'Jobs')}
        description={t('jobs.description', 'Found across your enabled sources, de-duplicated, and scored against your profile.')}
        actions={
          <Button icon={Search} loading={discoverState.isLoading || searching} onClick={startSearch}>
            {t('jobs.searchNow', 'Search now')}
          </Button>
        }
      />
      <div className="space-y-3">
        <ErrorMessage error={discoverState.error ?? error} />
        {searching && <Alert tone="green">{t('jobs.searchStarted', 'Searching… new jobs appear here as they are scored.')}</Alert>}
        {!searching && scoring && <Alert tone="green">{t('jobs.scoring', 'Scoring new jobs against your profile…')}</Alert>}
        {failedSources.length > 0 && (
          <Alert tone="amber">
            {failedSources.map(source => (
              <p key={source.key}>{t('jobs.sourceFailed', '{{name}} failed: {{error}}', { name: source.label, error: source.lastError })}</p>
            ))}
          </Alert>
        )}
        <Tabs
          tabs={[
            { id: '', label: t('jobs.all', 'All') },
            { id: 'NEW', label: t('jobs.new', 'New') },
            { id: 'SHORTLISTED', label: t('jobs.shortlisted', 'Shortlisted') },
            { id: 'SKIPPED', label: t('jobs.skipped', 'Skipped') },
          ]}
          active={status}
          onChange={value => {
            setStatus(value);
            setPage(1);
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Input className="max-w-xs" placeholder={t('jobs.searchPlaceholder', 'Search title or company')} aria-label={t('jobs.searchLabel', 'Search jobs')} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} />
          <Input className="w-36" type="number" min={0} max={100} placeholder={t('jobs.minScore', 'Min score')} aria-label={t('jobs.minScore', 'Min score')} value={minScore} onChange={event => { setMinScore(event.target.value); setPage(1); }} />
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" className="size-4" checked={includeFiltered} onChange={event => setIncludeFiltered(event.target.checked)} />
            {t('jobs.includeFiltered', 'Show jobs filtered out by keywords')}
          </label>
          {isFetching && !isLoading && !polling && <span className="text-xs text-slate-500">{t('common.updating', 'Updating…')}</span>}
        </div>
        {isLoading ? (
          <Spinner />
        ) : (
          <DataTable
            rows={data?.items}
            onRowClick={job => setOpenJob(job.id)}
            empty={t('jobs.empty', 'No jobs yet. Set target titles in your profile, then press “Search now”.')}
            columns={[
              { key: 'score', header: t('jobs.score', 'Score'), className: 'w-16', render: job => <ScoreBadge job={job} /> },
              {
                key: 'title',
                header: t('jobs.role', 'Role'),
                render: job => (
                  <div>
                    <p className="font-medium text-slate-900">{job.title}</p>
                    <p className="text-xs text-slate-500">
                      {job.company}
                      {job.location ? ` · ${job.location}` : ''}
                    </p>
                  </div>
                ),
              },
              { key: 'reason', header: t('jobs.why', 'Why'), className: 'max-w-sm', render: job => <span className="line-clamp-2 text-xs text-slate-600">{job.matchReason}</span> },
              { key: 'source', header: t('jobs.source', 'Source'), render: job => <span className="text-xs">{job.seenOn.join(', ')}</span> },
              {
                key: 'actions',
                header: '',
                render: job => (
                  <div onClick={event => event.stopPropagation()} role="presentation">
                    {actions(job)}
                  </div>
                ),
              },
            ]}
          />
        )}
        {data && data.total > PAGE_SIZE && (
          <div className="flex items-center justify-end gap-2 text-sm">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              {t('common.previous', 'Previous')}
            </Button>
            <span>
              {page} / {pages}
            </span>
            <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              {t('common.next', 'Next')}
            </Button>
          </div>
        )}
      </div>
      <JobDetail jobId={openJob} onClose={() => setOpenJob(null)} actions={actions} />
      {tailoring && <TailorDialog job={tailoring} onClose={() => setTailoring(null)} />}
    </div>
  );
}
