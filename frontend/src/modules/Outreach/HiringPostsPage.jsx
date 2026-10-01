import { ExternalLink, Mail, Search } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useHiringQueriesQuery, useListPostsQuery, usePostSourcesQuery, useSearchPostsMutation, useSetPostSourceMutation, useSetPostStatusMutation } from '@/app/api/outreach';
import { StatusBadge } from '@/common/components/StatusBadge';
import { Alert, Badge, Button, Card, ErrorMessage, PageHeader, Spinner, Tabs } from '@/common/components/ui';
import { SourceList } from '@/modules/Jobs/JobSourcesPage';

export default function HiringPostsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [status, setStatus] = useState('NEW');
  const { data: queries } = useHiringQueriesQuery();
  const { data: sources } = usePostSourcesQuery();
  const { data: posts, isLoading, error } = useListPostsQuery(status || undefined);
  const [search, searchState] = useSearchPostsMutation();
  const [setSource] = useSetPostSourceMutation();
  const [setPostStatus] = useSetPostStatusMutation();

  return (
    <div>
      <PageHeader
        title={t('posts.title', 'Hiring posts')}
        description={t('posts.description', 'Public LinkedIn posts that match your titles. Emails found in a post become contacts you can write to.')}
        actions={
          <Button icon={Search} loading={searchState.isLoading} onClick={() => search()}>
            {t('posts.search', 'Search posts')}
          </Button>
        }
      />
      <div className="space-y-4">
        <ErrorMessage error={searchState.error ?? error} />
        {searchState.isSuccess && <Alert tone="green">{t('posts.searching', 'Searching… new posts appear below.')}</Alert>}
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
          onChange={setStatus}
        />
        {isLoading ? (
          <Spinner />
        ) : !posts?.length ? (
          <p className="text-sm text-slate-600">{t('posts.empty', 'No posts here.')}</p>
        ) : (
          <ul className="space-y-3">
            {posts.map(post => (
              <li key={post.id} className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-medium">{post.author ?? t('posts.unknownAuthor', 'Unknown author')}</span>
                    {post.title && <span className="text-slate-500"> · {post.title}</span>}
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
      </div>
    </div>
  );
}
