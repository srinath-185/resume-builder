import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { useDisconnectMailMutation, useMailConnectorQuery, useSaveSmtpMutation, useStartGmailMutation, useTestMailMutation } from '@/app/api/outreach';
import { Alert, Badge, Button, Card, ErrorMessage, Field, Input, PageHeader, Spinner } from '@/common/components/ui';

export const SmtpSchema = z.object({
  host: z.string().trim().min(3, 'Required'),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().trim().min(1, 'Required'),
  pass: z.string().min(1, 'Required'),
  senderEmail: z.string().trim().email('Enter a valid email'),
  senderName: z.string().trim().max(120),
});

const GMAIL_RESULT = {
  connected: { tone: 'green', text: 'Gmail connected.' },
  error: { tone: 'red', text: 'Gmail sign-in did not complete. Try again.' },
  cancelled: { tone: 'amber', text: 'Gmail sign-in was cancelled.' },
};

export default function MailSettingsPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const { data: mail, isLoading, error } = useMailConnectorQuery();
  const [startGmail, gmailState] = useStartGmailMutation();
  const [saveSmtp, smtpState] = useSaveSmtpMutation();
  const [testMail, testState] = useTestMailMutation();
  const [disconnect, disconnectState] = useDisconnectMailMutation();
  const { register, handleSubmit, formState } = useForm({
    resolver: zodResolver(SmtpSchema),
    defaultValues: { host: 'smtp.gmail.com', port: 465, secure: true, user: '', pass: '', senderEmail: '', senderName: '' },
  });
  const gmailResult = GMAIL_RESULT[params.get('gmail')];

  const connectGmail = async () => {
    const result = await startGmail();
    if (result.data?.url) window.location.assign(result.data.url);
  };

  if (isLoading) return <Spinner />;
  return (
    <div>
      <PageHeader title={t('mail.title', 'Mailbox')} description={t('mail.description', 'Outreach is sent from your own address. Credentials are encrypted and never shown again.')} />
      <div className="space-y-4">
        {gmailResult && <Alert tone={gmailResult.tone}>{t(`mail.gmail.${params.get('gmail')}`, gmailResult.text)}</Alert>}
        <ErrorMessage error={error ?? gmailState.error ?? testState.error ?? disconnectState.error} />

        <Card
          title={t('mail.current', 'Current connection')}
          actions={
            mail?.provider && (
              <>
                <Button variant="secondary" loading={testState.isLoading} onClick={() => testMail()}>
                  {t('mail.test', 'Send test email')}
                </Button>
                <Button variant="ghost" loading={disconnectState.isLoading} onClick={() => disconnect()}>
                  {t('mail.disconnect', 'Disconnect')}
                </Button>
              </>
            )
          }
        >
          {!mail?.provider ? (
            <p className="text-sm text-slate-600">{t('mail.none', 'No mailbox connected.')}</p>
          ) : (
            <div className="space-y-1 text-sm">
              <p className="flex items-center gap-2">
                <span className="font-medium">{mail.senderEmail}</span>
                <Badge tone={mail.connected ? 'green' : 'red'}>{mail.connected ? t('mail.connected', 'connected') : t('mail.error', 'needs reconnect')}</Badge>
                <Badge>{mail.provider}</Badge>
              </p>
              {mail.lastError && <p className="text-red-600">{mail.lastError}</p>}
              {testState.isSuccess && <Alert tone="green">{t('mail.testSent', 'Test email sent to {{email}}.', { email: mail.senderEmail })}</Alert>}
            </div>
          )}
        </Card>

        <Card title={t('mail.gmailTitle', 'Gmail (recommended)')}>
          <p className="mb-3 text-sm text-slate-600">
            {t('mail.gmailHint', 'Sign in with Google. The app can only send email as you (gmail.send); it can never read your inbox. Gmail does not support sending with an API key.')}
          </p>
          {mail?.gmailAvailable ? (
            <Button loading={gmailState.isLoading} onClick={connectGmail}>
              {t('mail.connectGmail', 'Connect Gmail')}
            </Button>
          ) : (
            <Alert tone="amber">{t('mail.gmailUnavailable', 'Google sign-in is not configured on this server. Use SMTP below (for Gmail, create an App Password).')}</Alert>
          )}
        </Card>

        <Card title={t('mail.smtpTitle', 'SMTP')}>
          <form onSubmit={handleSubmit(values => saveSmtp({ ...values, senderName: values.senderName || undefined }))} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t('mail.host', 'Host')} htmlFor="host" error={formState.errors.host?.message}>
                <Input id="host" {...register('host')} />
              </Field>
              <Field label={t('mail.port', 'Port')} htmlFor="port" error={formState.errors.port && t('mail.portInvalid', 'Enter a port number')}>
                <Input id="port" type="number" {...register('port')} />
              </Field>
              <label className="flex items-center gap-2 self-end text-sm">
                <input type="checkbox" className="size-4" {...register('secure')} />
                {t('mail.secure', 'TLS (port 465)')}
              </label>
              <Field label={t('mail.user', 'Username')} htmlFor="user" error={formState.errors.user?.message}>
                <Input id="user" autoComplete="off" {...register('user')} />
              </Field>
              <Field label={t('mail.pass', 'Password or App Password')} htmlFor="pass" error={formState.errors.pass?.message}>
                <Input id="pass" type="password" autoComplete="new-password" {...register('pass')} />
              </Field>
              <div />
              <Field label={t('mail.senderEmail', 'Send as (email)')} htmlFor="senderEmail" error={formState.errors.senderEmail?.message}>
                <Input id="senderEmail" type="email" {...register('senderEmail')} />
              </Field>
              <Field label={t('mail.senderName', 'Send as (name)')} htmlFor="senderName">
                <Input id="senderName" {...register('senderName')} />
              </Field>
            </div>
            <ErrorMessage error={smtpState.error} />
            {smtpState.isSuccess && <Alert tone="green">{t('mail.smtpSaved', 'SMTP login verified and saved.')}</Alert>}
            <div className="flex justify-end">
              <Button type="submit" loading={smtpState.isLoading}>
                {t('mail.saveSmtp', 'Verify and save')}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
