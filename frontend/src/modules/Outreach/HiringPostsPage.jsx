import { ExternalLink, Mail, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useHiringQueriesQuery, useListPostsQuery, usePostSourcesQuery, useSearchPostsMutation, useSetPostSourceMutation, useSetPostStatusMutation } from '@/app/api/outreach';
import { Pager } from '@/common/components/Pager';
import { StatusBadge } from '@/common/components/StatusBadge';
import { Alert, Badge, Button, Card, ErrorMessage, Input, PageHeader, Select, Spinner, Tabs } from '@/common/components/ui';
import { SourceList } from '@/modules/Jobs/JobSourcesPage';

const PAGE_SIZE = 10;

/** Same values as the API's postedWithin. */
const POSTED_WITHIN = [
  ['1h', 'Past hour'],
  ['24h', 'Past 24 hours'],
  ['week', 'Past week'],
  ['month', 'Past month'],
  ['3months', 'Past 3 months'],
  ['6months', 'Past 6 months'],
  ['year', 'Past year'],
  ['any', 'Any time'],
];

const UNITS = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

/** "3 hours ago", "2 days ago" in the active language. */
function timeAgo(value, language) {
  const seconds = (new Date(value).getTime() - Date.now()) / 1000;
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  const [unit, size] = UNITS.find(([, size]) => Math.abs(seconds) >= size) ?? ['minute', 60];
  return format.format(Math.round(seconds / size), unit);
}

const latestRun = sources => Math.max(0, ...(sources ?? []).map(source => (source.lastRunAt ? new Date(source.lastRunAt).getTime() : 0)));

export default function HiringPostsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [status, setStatus] = useState('NEW');
  const [query, setQuery] = useState('');
  const [postedWithin, setPostedWithin] = useState('week');
  const [page, setPage] = useState(1);
  // Set while a queued search runs: the latest source run seen before it started. Lists refresh until a newer run shows up.
  const [pendingSince, setPendingSince] = useState(null);
  const searching = pendingSince !== null;
  const pollingInterval = searching ? 3000 : 0;
  const { data: queries } = useHiringQueriesQuery();
  const { data: sources } = usePostSourcesQuery(undefined, { pollingInterval });
  const { data, isLoading, error } = useListPostsQuery({ status: status || undefined, q: query.trim() || undefined, postedWithin, page, limit: PAGE_SIZE }, { pollingInterval });
  const posts = data?.items;
  const canSearch = Boolean(sources?.some(source => source.configured && source.enabled));
  const [search, searchState] = useSearchPostsMutation();
  const [setSource] = useSetPostSourceMutation();
  const [setPostStatus] = useSetPostStatusMutation();

  useEffect(() => {
    if (searching && latestRun(sources) > pendingSince) setPendingSince(null);
  }, [searching, pendingSince, sources]);

  useEffect(() => {
    if (!searching) return undefined;
    const timeout = setTimeout(() => setPendingSince(null), 3 * 60_000);
    return () => clearTimeout(timeout);
  }, [searching]);

  const startSearch = async () => {
    const before = latestRun(sources);
    const result = await search({ postedWithin });
    if (!result.error) setPendingSince(before);
  };

  return (
    <div>
      <PageHeader
        title={t('posts.title', 'Hiring posts')}
        description={t('posts.description', 'Public LinkedIn posts that match your titles. Emails found in a post become contacts you can write to.')}
        actions={
          <Button icon={Search} loading={searchState.isLoading || searching} disabled={!canSearch} onClick={startSearch}>
            {t('posts.search', 'Search posts')}
          </Button>
        }
      />
      <div className="space-y-4">
        <ErrorMessage error={searchState.error ?? error} />
        {sources && !canSearch && (
          <Alert tone="amber">{t('posts.noSources', 'No post source can run yet. Add a SerpAPI key on the server (SERPAPI_KEY), then turn it on under Post sources.')}</Alert>
        )}
        {searching && <Alert tone="green">{t('posts.searching', 'Searching… new posts appear below.')}</Alert>}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card
            title={t('posts.queries', 'Queries that will run')}
            actions={
              <Link to="/profile" className="text-sm text-brand-700 hover:underline">
                {t('posts.editTemplate', 'Edit template')}
              </Link>
            }
          >
            {queries?.queries?.length ? (
              <ul className="space-y-1">
                {queries.queries.map(query => (
                  <li key={query}>
                    <code className="text-xs">{query}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-600">{t('posts.noTitles', 'Add target titles to your profile.')}</p>
            )}
          </Card>
          <Card title={t('posts.sources', 'Post sources')}>
            <SourceList sources={sources ?? []} onToggle={(key, enabled) => setSource({ key, enabled })} />
          </Card>
        </div>

        <Tabs
          tabs={[
            { id: 'NEW', label: t('posts.new', 'New') },
            { id: 'CONTACTED', label: t('posts.contacted', 'Contacted') },
            { id: 'IGNORED', label: t('posts.ignored', 'Ignored') },
            { id: '', label: t('posts.all', 'All') },
          ]}
          active={status}
          onChange={value => {
            setStatus(value);
            setPage(1);
          }}
        />
        <div className="grid gap-2 sm:grid-cols-[minmax(0,24rem)_auto]">
          <Input
            placeholder={t('posts.filterPlaceholder', 'Search post text, author or title')}
            aria-label={t('posts.filterLabel', 'Search posts')}
            value={query}
            onChange={event => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
          <Select
            aria-label={t('posts.postedWithin', 'Posted within')}
            title={t('posts.postedWithinHint', 'Filters the list and sets how far back the next search looks')}
            value={postedWithin}
            onChange={event => {
              setPostedWithin(event.target.value);
              setPage(1);
            }}
          >
            {POSTED_WITHIN.map(([value, label]) => (
              <option key={value} value={value}>
                {t(`posts.within.${value}`, label)}
              </option>
            ))}
          </Select>
        </div>
        {isLoading ? (
          <Spinner />
        ) : !posts?.length ? (
          <p className="text-sm text-slate-600">{query.trim() ? t('posts.noMatch', 'No posts match your search.') : t('posts.empty', 'No posts here.')}</p>
        ) : (
          <ul className="space-y-3">
            {posts.map(post => (
              <li key={post.id} className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-medium">{post.author ?? t('posts.unknownAuthor', 'Unknown author')}</span>
                    {post.title && <span className="text-slate-500"> · {post.title}</span>}
                    {post.postedAt && (
                      <time className="text-slate-500" dateTime={post.postedAt} title={new Date(post.postedAt).toLocaleString(i18n.language)}>
                        {' · '}
                        {timeAgo(post.postedAt, i18n.language)}
                      </time>
                    )}
                  </div>
                  <StatusBadge status={post.status} />
                </div>
                <p className="mt-2 line-clamp-4 whitespace-pre-line text-sm text-slate-700">{post.text}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {post.extractedEmails.map(email => (
                    <Button key={email} variant="secondary" icon={Mail} onClick={() => navigate(`/outreach/new?email=${encodeURIComponent(email)}&name=${encodeURIComponent(post.author ?? '')}&hiringPostId=${post.id}`)}>
                      {email}
                    </Button>
                  ))}
                  {post.extractedEmails.length === 0 && <Badge>{t('posts.noEmail', 'no email in post')}</Badge>}
                  <a href={post.postUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
                    {t('posts.open', 'Open post')} <ExternalLink className="size-3" aria-hidden />
                  </a>
                  {post.status === 'NEW' && (
                    <Button variant="ghost" onClick={() => setPostStatus({ id: post.id, status: 'IGNORED' })}>
                      {t('posts.ignore', 'Ignore')}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {data && <Pager page={page} total={data.total} pageSize={PAGE_SIZE} onChange={setPage} />}
      </div>
    </div>
  );
}
