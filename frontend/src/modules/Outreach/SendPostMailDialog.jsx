import { CheckCircle2, Paperclip, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useCancelOutreachMutation, useDraftOutreachMutation, useGetOutreachQuery, useMailConnectorQuery, useSendOutreachMutation, useUpdateOutreachMutation } from '@/app/api/outreach';
import { Alert, Button, ErrorMessage, Field, Input, Modal, Spinner, TextArea } from '@/common/components/ui';

const DONE = ['SENT', 'FAILED', 'CANCELLED'];

/**
 * Drafts an email to an address found in a hiring post (primary resume attached),
 * lets the user edit it, and sends it through the connected mailbox (Gmail API or SMTP).
 */
export function SendPostMailDialog({ post, email, onClose }) {
  const { t } = useTranslation();
  const { data: mail, isLoading: mailLoading } = useMailConnectorQuery();
  const [draft, draftState] = useDraftOutreachMutation();
  const [update, updateState] = useUpdateOutreachMutation();
  const [send, sendState] = useSendOutreachMutation();
  const [cancel] = useCancelOutreachMutation();
  const [message, setMessage] = useState(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const requested = useRef(false);

  const { data: delivery } = useGetOutreachQuery(message?.id, { skip: !sending, pollingInterval: sending ? 1500 : 0 });
  const status = sending ? delivery?.status : message?.status;
  const sent = status === 'SENT';
  const failed = status === 'FAILED';

  useEffect(() => {
    if (!mail?.connected || requested.current) return;
    requested.current = true;
    draft({ hiringPostId: post.id, email, ...(post.author ? { name: post.author } : {}) }).then(result => {
      if (!result.data) return;
      setMessage(result.data);
      setSubject(result.data.subject);
      setBody(result.data.body);
    });
  }, [mail?.connected, draft, post, email]);

  useEffect(() => {
    if (!sending || !DONE.includes(delivery?.status)) return;
    setSending(false);
    setMessage(delivery);
  }, [sending, delivery]);

  const close = () => {
    // A draft the user walked away from is cancelled so it does not linger in the outbox.
    if (message && message.status === 'DRAFT' && !sending) cancel(message.id);
    onClose();
  };

  const submit = async event => {
    event.preventDefault();
    if (subject !== message.subject || body !== message.body) {
      const saved = await update({ id: message.id, subject, body });
      if (saved.error) return;
    }
    const queued = await send(message.id);
    if (queued.error) return;
    setMessage(queued.data);
    setSending(!DONE.includes(queued.data.status));
  };

  const provider = mail?.provider === 'GMAIL' ? 'Gmail' : 'SMTP';
  const busy = updateState.isLoading || sendState.isLoading || sending;

  return (
    <Modal
      open
      wide
      title={t('postMail.title', 'Email {{email}}', { email })}
      onClose={close}
      footer={
        sent ? (
          <Button onClick={onClose}>{t('postMail.done', 'Done')}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>
              {t('common.cancel', 'Cancel')}
            </Button>
            {message && (
              <Button type="submit" form="post-mail-form" icon={Send} loading={busy}>
                {failed ? t('postMail.retry', 'Try again') : t('postMail.send', 'Send via {{provider}}', { provider })}
              </Button>
            )}
          </>
        )
      }
    >
      {mailLoading ? (
        <Spinner />
      ) : !mail?.connected ? (
        <Alert tone="amber">
          {t('postMail.noMailbox', 'Connect Gmail before sending.')}{' '}
          <Link to="/settings/mail" className="font-medium underline">
            {t('postMail.connect', 'Connect now')}
          </Link>
        </Alert>
      ) : sent ? (
        <div className="flex items-center gap-2 text-sm text-green-700">
          <CheckCircle2 className="size-5" aria-hidden />
          {t('postMail.sent', 'Sent to {{email}} from {{from}}.', { email, from: mail.senderEmail })}
        </div>
      ) : !message ? (
        draftState.error ? <ErrorMessage error={draftState.error} /> : <Spinner label={t('postMail.drafting', 'Preparing the email…')} />
      ) : (
        <form id="post-mail-form" onSubmit={submit} className="space-y-4">
          <p className="text-sm text-slate-600">{t('postMail.from', 'From {{from}} via {{provider}}', { from: mail.senderEmail, provider })}</p>
          <Field label={t('postMail.subject', 'Subject')} htmlFor="post-mail-subject">
            <Input id="post-mail-subject" value={subject} maxLength={200} required onChange={event => setSubject(event.target.value)} disabled={busy} />
          </Field>
          <Field label={t('postMail.body', 'Message')} htmlFor="post-mail-body">
            <TextArea id="post-mail-body" rows={12} maxLength={6000} value={body} required onChange={event => setBody(event.target.value)} disabled={busy} />
          </Field>
          {message.attachmentName && (
            <p className="flex items-center gap-1 text-sm text-slate-600">
              <Paperclip className="size-4" aria-hidden />
              {message.attachmentName}
            </p>
          )}
          {failed && <Alert tone="red">{message.error ?? t('postMail.failed', 'Sending failed.')}</Alert>}
          <ErrorMessage error={updateState.error ?? sendState.error} />
        </form>
      )}
    </Modal>
  );
}
