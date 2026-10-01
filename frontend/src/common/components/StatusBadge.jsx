import { Badge } from './ui';

const TONES = {
  // resumes
  PENDING: 'gray',
  PARSING: 'blue',
  PARSED: 'green',
  FAILED: 'red',
  // jobs
  NEW: 'blue',
  SHORTLISTED: 'green',
  SKIPPED: 'gray',
  SCORED: 'green',
  FILTERED_OUT: 'gray',
  // applications
  MATCHED: 'gray',
  TAILORING: 'blue',
  TAILOR_FAILED: 'red',
  REVIEW_PENDING: 'amber',
  REJECTED: 'gray',
  APPROVED: 'green',
  APPLYING: 'blue',
  APPLIED: 'green',
  NEEDS_REVIEW: 'amber',
  // outreach
  DRAFT: 'amber',
  QUEUED: 'blue',
  SENT: 'green',
  CANCELLED: 'gray',
  CONTACTED: 'green',
  IGNORED: 'gray',
};

const LABELS = {
  REVIEW_PENDING: 'Review pending',
  NEEDS_REVIEW: 'Needs attention',
  TAILOR_FAILED: 'Tailoring failed',
  FILTERED_OUT: 'Filtered out',
};

export function StatusBadge({ status }) {
  if (!status) return null;
  const label = LABELS[status] ?? status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ');
  return <Badge tone={TONES[status] ?? 'gray'}>{label}</Badge>;
}
