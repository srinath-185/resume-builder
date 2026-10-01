import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useTailorJobMutation } from '@/app/api/jobs';
import { Alert, Button, ErrorMessage, Field, Modal, TextArea } from '@/common/components/ui';

/** Starts tailoring for one job, with optional instructions, then opens the review screen. */
export function TailorDialog({ job, onClose }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [instructions, setInstructions] = useState('');
  const [tailor, state] = useTailorJobMutation();

  const start = async () => {
    const result = await tailor({ id: job.id, instructions: instructions.trim() || undefined });
    if (result.data) navigate(`/applications/${result.data.id}`);
  };

  return (
    <Modal
      open={Boolean(job)}
      title={t('jobs.tailorTitle', 'Tailor your resume for {{title}}', { title: job?.title })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button loading={state.isLoading} onClick={start}>
            {t('jobs.startTailoring', 'Draft tailored resume')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Alert>{t('jobs.tailorPromise', 'You will review the draft, with every change explained, before it is used anywhere.')}</Alert>
        <Field label={t('jobs.instructions', 'Instructions (optional)')} hint={t('jobs.instructionsHint', 'For example: emphasise payments work, keep it to one page.')} htmlFor="instructions">
          <TextArea id="instructions" rows={3} maxLength={1000} value={instructions} onChange={event => setInstructions(event.target.value)} />
        </Field>
        <ErrorMessage error={state.error} />
      </div>
    </Modal>
  );
}
