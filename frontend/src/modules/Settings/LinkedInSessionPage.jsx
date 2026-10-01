import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDeletePortalSessionMutation, usePortalSessionsQuery, useSavePortalSessionMutation } from '@/app/api/outreach';
import { Alert, Badge, Button, Card, ErrorMessage, Field, Input, PageHeader, Spinner } from '@/common/components/ui';

export default function LinkedInSessionPage() {
  const { t } = useTranslation();
  const { data: sessions, isLoading } = usePortalSessionsQuery();
  const [save, saveState] = useSavePortalSessionMutation();
  const [remove, removeState] = useDeletePortalSessionMutation();
  const [liAt, setLiAt] = useState('');
  const linkedin = sessions?.find(session => session.portal === 'linkedin');

  if (isLoading) return <Spinner />;
  return (
    <div>
      <PageHeader title={t('session.title', 'LinkedIn Easy Apply')} description={t('session.description', 'Optional. Lets the assisted apply use your own LinkedIn session for Easy Apply jobs.')} />
      <div className="space-y-4">
        <Alert tone="amber">
          {t('session.warning', 'Automating LinkedIn may break its terms and can get an account restricted. Use it sparingly, keep the daily apply cap low, or apply manually with the approved PDF.')}
        </Alert>
        <Card title={t('session.current', 'Saved session')}>
          {linkedin ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={linkedin.status === 'VALID' ? 'green' : 'red'}>{linkedin.status === 'VALID' ? t('session.valid', 'saved') : t('session.expired', 'expired')}</Badge>
              {linkedin.lastUsedAt && <span className="text-slate-600">{t('session.lastUsed', 'last used {{when}}', { when: new Date(linkedin.lastUsedAt).toLocaleString() })}</span>}
              <Button variant="ghost" loading={removeState.isLoading} onClick={() => remove('linkedin')}>
                {t('session.remove', 'Remove')}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-slate-600">{t('session.none', 'No session saved.')}</p>
          )}
        </Card>
        <Card title={t('session.save', 'Save a session')}>
          <form
            onSubmit={async event => {
              event.preventDefault();
              if (!(await save({ portal: 'linkedin', liAt: liAt.trim() })).error) setLiAt('');
            }}
            className="space-y-3"
          >
            <Field label={t('session.liAt', 'li_at cookie value')} hint={t('session.liAtHint', 'Browser dev tools → Application → Cookies → linkedin.com → li_at. Stored encrypted; never shown again.')} htmlFor="liAt">
              <Input id="liAt" type="password" autoComplete="off" value={liAt} onChange={event => setLiAt(event.target.value)} />
            </Field>
            <ErrorMessage error={saveState.error} />
            <div className="flex justify-end">
              <Button type="submit" disabled={liAt.trim().length < 10} loading={saveState.isLoading}>
                {t('session.saveButton', 'Save session')}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
