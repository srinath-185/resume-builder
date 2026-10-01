import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useListOutreachQuery, useMailConnectorQuery } from '@/app/api/outreach';
import { Alert, Card } from '@/common/components/ui';

export function OutboxWidget() {
  const { t } = useTranslation();
  const { data: drafts } = useListOutreachQuery('DRAFT');
  const { data: mail } = useMailConnectorQuery();
  return (
    <Card title={t('dashboard.outbox', 'Outreach')}>
      <div className="space-y-2 text-sm">
        {!mail?.connected && (
          <Alert tone="amber">
            <Link to="/settings/mail" className="font-medium underline">
              {t('dashboard.connectMail', 'Connect your mailbox to email recruiters')}
            </Link>
          </Alert>
        )}
        <p>
          <Link to="/outreach" className="text-brand-700 hover:underline">
            {t('dashboard.drafts', '{{count}} draft email(s) waiting', { count: drafts?.length ?? 0 })}
          </Link>
        </p>
      </div>
    </Card>
  );
}
