import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useGetProfileQuery, useListResumesQuery } from '@/app/api/resumes';
import { StatusBadge } from '@/common/components/StatusBadge';
import { Alert, Card } from '@/common/components/ui';

export function ResumeWidget() {
  const { t } = useTranslation();
  const { data: resumes } = useListResumesQuery();
  const { data: profile } = useGetProfileQuery();
  const primary = resumes?.find(resume => resume.isPrimary);
  return (
    <Card title={t('dashboard.resume', 'Your resume')}>
      {!primary ? (
        <Alert tone="amber">
          <Link to="/resumes" className="font-medium underline">
            {t('dashboard.uploadFirst', 'Upload your resume to get started')}
          </Link>
        </Alert>
      ) : (
        <div className="space-y-2 text-sm">
          <p className="flex items-center gap-2">
            <Link to={`/resumes/${primary.id}`} className="font-medium text-brand-700 hover:underline">
              {primary.fileName}
            </Link>
            <StatusBadge status={primary.parseStatus} />
          </p>
          <p className="text-slate-600">
            {t('dashboard.targets', 'Targeting')}: {profile?.targetTitles?.join(', ') || t('dashboard.noTargets', 'no titles yet')}
            {profile?.location ? ` · ${profile.location}` : ''}
          </p>
        </div>
      )}
    </Card>
  );
}
