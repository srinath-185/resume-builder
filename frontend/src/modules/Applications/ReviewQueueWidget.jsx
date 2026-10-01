import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useListApplicationsQuery } from '@/app/api/applications';
import { Alert, Card } from '@/common/components/ui';

export function ReviewQueueWidget() {
  const { t } = useTranslation();
  const { data: pending } = useListApplicationsQuery('REVIEW_PENDING');
  const { data: attention } = useListApplicationsQuery('NEEDS_REVIEW');
  const waiting = pending?.length ?? 0;
  const stuck = attention?.length ?? 0;
  return (
    <Card title={t('dashboard.review', 'Waiting for you')}>
      {waiting === 0 && stuck === 0 ? (
        <p className="text-sm text-slate-600">{t('dashboard.nothingWaiting', 'Nothing to review right now.')}</p>
      ) : (
        <div className="space-y-2">
          {waiting > 0 && (
            <Alert tone="amber">
              <Link to="/applications" className="font-medium underline">
                {t('dashboard.toReview', '{{count}} tailored resume(s) to review', { count: waiting })}
              </Link>
            </Alert>
          )}
          {stuck > 0 && <Alert tone="red">{t('dashboard.stuck', '{{count}} application(s) need your attention', { count: stuck })}</Alert>}
        </div>
      )}
    </Card>
  );
}
