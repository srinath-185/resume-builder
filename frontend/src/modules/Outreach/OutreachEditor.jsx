import { Send, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCancelOutreachMutation, useGetOutreachQuery, useSendOutreachMutation, useUpdateOutreachMutation } from '@/app/api/outreach';
import { StatusBadge } from '@/common/components/StatusBadge';
import { Alert, Button, ErrorMessage, Field, Input, Modal, Spinner, TextArea } from '@/common/components/ui';

/** Review an email before it goes out. Only drafts are editable; Send is the only way anything is sent. */
export function OutreachEditor({ id, onClose }) {
  const { t } = useTranslation();
  const { data: message, isLoading } = useGetOutreachQuery(id, { skip: !id, pollingInterval: 3000 });
  const [update, updateState] = useUpdateOutreachMutation();
  const [send, sendState] = useSendOutreachMutation();
  const [cancel, cancelState] = useCancelOutreachMutation();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  useEffect(() => {
    if (message) {
      setSubject(message.subject);
      setBody(message.body);
    }
  }, [message?.id, message?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const editable = message && (message.status === 'DRAFT' || message.status === 'FAILED');
  const dirty = message && (subject !== message.subject || body !== message.body);

  const sendNow = async () => {
    if (dirty && message.status === 'DRAFT' && (await update({ id, subject, body })).error) return;
    await send(id);
  };

  return (
    <Modal
      open={Boolean(id)}
      wide
      title={message ? t('outreach.to', 'Email to {{email}}', { email: message.toEmail }) : t('common.loading', 'Loading…')}
      onClose={onClose}
      footer={
        message && (
          <>
            {['DRAFT', 'QUEUED'].includes(message.status) && (
              <Button variant="ghost" icon={XCircle} loading={cancelState.isLoading} onClick={() => cancel(id)}>
                {t('outreach.cancel', 'Cancel email')}
              </Button>
            )}
            {message.status === 'DRAFT' && dirty && (
              <Button variant="secondary" loading={updateState.isLoading} onClick={() => update({ id, subject, body })}>
                {t('outreach.saveDraft', 'Save draft')}
              </Button>
            )}
            {editable && (
              <Button icon={Send} loading={sendState.isLoading || updateState.isLoading} onClick={sendNow}>
                {message.status === 'FAILED' ? t('outreach.retry', 'Try again') : t('outreach.send', 'Send')}
              </Button>
            )}
          </>
        )
      }
    >
      {isLoading || !message ? (
        <Spinner />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <StatusBadge status={message.status} />
            {message.sequence === 2 && <span className="text-slate-600">{t('outreach.followUp', 'Follow-up')}</span>}
            {message.attachmentName && message.sequence === 1 && (
              <span className="text-slate-600">
                {t('outreach.attachment', 'Attaches your approved resume')}: <code className="text-xs">{message.attachmentName}</code>
              </span>
            )}
            {message.sentAt && <span className="text-slate-600">{t('outreach.sentAt', 'Sent {{when}}', { when: new Date(message.sentAt).toLocaleString() })}</span>}
          </div>
          {message.status === 'FAILED' && message.error && <Alert tone="red">{message.error}</Alert>}
          {message.status === 'QUEUED' && <Alert>{t('outreach.queued', 'Sending…')}</Alert>}
          <ErrorMessage error={sendState.error ?? updateState.error ?? cancelState.error} />
          <Field label={t('outreach.subject', 'Subject')} htmlFor="subject">
            <Input id="subject" value={subject} disabled={message.status !== 'DRAFT'} onChange={event => setSubject(event.target.value)} />
          </Field>
          <Field label={t('outreach.body', 'Message')} htmlFor="body">
            <TextArea id="body" rows={14} value={body} disabled={message.status !== 'DRAFT'} onChange={event => setBody(event.target.value)} />
          </Field>
        </div>
      )}
    </Modal>
  );
}
