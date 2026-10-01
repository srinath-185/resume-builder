import { CheckCircle2, Download, ExternalLink, RefreshCw, Send, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import {
  useApproveApplicationMutation,
  useMarkAppliedMutation,
  useRegenerateApplicationMutation,
  useRejectApplicationMutation,
  useStartApplyMutation,
} from '@/app/api/applications';
import { selectToken } from '@/app/authSlice';
import { Button, ErrorMessage, Field, Modal, TextArea } from '@/common/components/ui';
import { downloadAuthorized } from '@/common/hooks/useAuthorizedFile';
import { APPLICATION_EXTRA_ACTIONS } from './extraActions';

function InstructionsModal({ open, title, confirmLabel, onConfirm, onClose, loading, field }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button loading={loading} onClick={() => onConfirm(text.trim() || undefined)}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Field label={field} htmlFor="modal-text">
        <TextArea id="modal-text" rows={3} maxLength={1000} value={text} onChange={event => setText(event.target.value)} />
      </Field>
    </Modal>
  );
}

/** The buttons that make sense for the application's current status; the server enforces the same rules. */
export function ApplicationActions({ review }) {
  const { t } = useTranslation();
  const token = useSelector(selectToken);
  const { application, listing, variant } = review;
  const [approve, approveState] = useApproveApplicationMutation();
  const [reject, rejectState] = useRejectApplicationMutation();
  const [regenerate, regenerateState] = useRegenerateApplicationMutation();
  const [apply, applyState] = useStartApplyMutation();
  const [markApplied, markState] = useMarkAppliedMutation();
  const [modal, setModal] = useState(null);

  const id = application.id;
  const status = application.status;
  const fileName = `resume-${listing.company}-${listing.title}.pdf`.replace(/[^A-Za-z0-9.]+/g, '-');
  const factCheckFailed = variant && !variant.factCheck.passed;
  const canApply = ['APPROVED', 'NEEDS_REVIEW', 'FAILED'].includes(status);
  const error = approveState.error ?? rejectState.error ?? regenerateState.error ?? applyState.error ?? markState.error;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {status === 'REVIEW_PENDING' && (
          <>
            <Button icon={CheckCircle2} loading={approveState.isLoading} disabled={factCheckFailed} onClick={() => approve(id)} title={factCheckFailed ? t('review.fixFirst', 'Fix the fact-check issues first') : undefined}>
              {t('review.approve', 'Approve')}
            </Button>
            <Button variant="secondary" icon={RefreshCw} onClick={() => setModal('regenerate')}>
              {t('review.regenerate', 'Regenerate')}
            </Button>
            <Button variant="ghost" icon={XCircle} onClick={() => setModal('reject')}>
              {t('review.reject', 'Reject')}
            </Button>
          </>
        )}
        {['TAILOR_FAILED', 'REJECTED', 'APPROVED'].includes(status) && (
          <Button variant="secondary" icon={RefreshCw} onClick={() => setModal('regenerate')}>
            {status === 'APPROVED' ? t('review.retailor', 'Tailor again') : t('review.regenerate', 'Regenerate')}
          </Button>
        )}
        {canApply && (
          <Button icon={Send} loading={applyState.isLoading} onClick={() => apply(id)}>
            {status === 'APPROVED' ? t('review.apply', 'Apply for me') : t('review.retryApply', 'Try applying again')}
          </Button>
        )}
        {APPLICATION_EXTRA_ACTIONS.map((Action, index) => (
          <Action key={index} review={review} />
        ))}
        {variant && (
          <Button variant="secondary" icon={Download} onClick={() => downloadAuthorized(`/applications/${id}/resume.pdf`, fileName, token)}>
            {t('review.download', 'Download PDF')}
          </Button>
        )}
        {canApply && (
          <Button variant="ghost" loading={markState.isLoading} onClick={() => markApplied(id)}>
            {t('review.markApplied', 'I applied myself')}
          </Button>
        )}
        <a href={listing.applyUrl ?? listing.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm text-brand-700 hover:bg-brand-50">
          {t('review.openJob', 'Open job')} <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>
      <ErrorMessage error={error} />

      <InstructionsModal
        open={modal === 'regenerate'}
        title={t('review.regenerateTitle', 'Draft a new version')}
        field={t('review.regenerateField', 'What should change? (optional)')}
        confirmLabel={t('review.regenerate', 'Regenerate')}
        loading={regenerateState.isLoading}
        onClose={() => setModal(null)}
        onConfirm={async instructions => {
          if (!(await regenerate({ id, instructions })).error) setModal(null);
        }}
      />
      <InstructionsModal
        open={modal === 'reject'}
        title={t('review.rejectTitle', 'Reject this draft')}
        field={t('review.rejectField', 'Reason (optional, for your records)')}
        confirmLabel={t('review.reject', 'Reject')}
        loading={rejectState.isLoading}
        onClose={() => setModal(null)}
        onConfirm={async reason => {
          if (!(await reject({ id, reason })).error) setModal(null);
        }}
      />
    </div>
  );
}
