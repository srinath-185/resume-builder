import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useGetJobQuery } from '@/app/api/jobs';
import { StatusBadge } from '@/common/components/StatusBadge';
import { Badge, Modal, Spinner } from '@/common/components/ui';

export function ScoreBadge({ job }) {
  if (job.matchStatus === 'SCORED') {
    const tone = job.matchScore >= 80 ? 'green' : job.matchScore >= 60 ? 'blue' : 'gray';
    return <Badge tone={tone}>{job.matchScore}</Badge>;
  }
  return <StatusBadge status={job.matchStatus === 'PENDING' ? 'PENDING' : job.matchStatus} />;
}

export function JobDetail({ jobId, onClose, actions }) {
  const { t } = useTranslation();
  const { data: job, isLoading } = useGetJobQuery(jobId, { skip: !jobId });
  return (
    <Modal open={Boolean(jobId)} wide title={job ? `${job.title} — ${job.company}` : t('common.loading', 'Loading…')} onClose={onClose} footer={job && actions?.(job)}>
      {isLoading || !job ? (
        <Spinner />
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2 text-slate-600">
            <ScoreBadge job={job} />
            {job.location && <span>{job.location}</span>}
            {job.remote && <Badge tone="blue">{t('jobs.remote', 'Remote')}</Badge>}
            {job.salary && <span>· {job.salary}</span>}
            <span>· {t('jobs.seenOn', 'seen on')} {job.seenOn.join(', ')}</span>
          </div>
          {job.matchReason && <p className="rounded-md bg-slate-50 p-3 text-slate-700">{job.matchReason}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-slate-500">{t('jobs.matched', 'You have')}</p>
              <div className="flex flex-wrap gap-1">{job.matchedSkills.map(skill => <Badge key={skill} tone="green">{skill}</Badge>)}</div>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-slate-500">{t('jobs.missing', 'Gaps')}</p>
              <div className="flex flex-wrap gap-1">{job.missingSkills.map(skill => <Badge key={skill} tone="amber">{skill}</Badge>)}</div>
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase text-slate-500">{t('jobs.applyLinks', 'Apply links')}</p>
            <ul className="space-y-1">
              {[{ publisher: t('jobs.primaryLink', 'Listing'), url: job.applyUrl ?? job.url }, ...job.applyOptions].map(option => (
                <li key={option.url}>
                  <a href={option.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                    {option.publisher} <ExternalLink className="size-3" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase text-slate-500">{t('jobs.description', 'Description')}</p>
            <div className="max-h-80 overflow-y-auto whitespace-pre-line rounded-md ring-1 ring-slate-200 p-3 text-slate-700">{job.description}</div>
          </div>
        </div>
      )}
    </Modal>
  );
}
