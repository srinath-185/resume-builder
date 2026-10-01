import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useListJobsQuery } from '@/app/api/jobs';
import { Card } from '@/common/components/ui';
import { ScoreBadge } from './JobDetail';

export function JobsWidget() {
  const { t } = useTranslation();
  const { data } = useListJobsQuery({ status: 'NEW', limit: 5, page: 1 });
  return (
    <Card
      title={t('dashboard.topJobs', 'Top new matches')}
      actions={
        <Link to="/jobs" className="text-sm text-brand-700 hover:underline">
          {t('dashboard.allJobs', 'All jobs')}
        </Link>
      }
    >
      {!data?.items?.length ? (
        <p className="text-sm text-slate-600">{t('dashboard.noJobs', 'No new jobs yet.')}</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {data.items.map(job => (
            <li key={job.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0 truncate">
                {job.title} · <span className="text-slate-500">{job.company}</span>
              </span>
              <ScoreBadge job={job} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
