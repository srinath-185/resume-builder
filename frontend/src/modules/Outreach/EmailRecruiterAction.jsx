import { Mail } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/common/components/ui';

const HAS_APPROVED = ['APPROVED', 'APPLYING', 'APPLIED', 'NEEDS_REVIEW', 'FAILED'];

/** Review-screen button: only offered once a tailored resume is approved. */
export function EmailRecruiterAction({ review }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  if (!HAS_APPROVED.includes(review.application.status)) return null;
  return (
    <Button variant="secondary" icon={Mail} onClick={() => navigate(`/outreach/new?applicationId=${review.application.id}`)}>
      {t('review.emailRecruiter', 'Email a recruiter')}
    </Button>
  );
}
