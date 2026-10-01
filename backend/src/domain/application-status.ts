export enum ApplicationStatus {
  MATCHED = 'MATCHED',
  TAILORING = 'TAILORING',
  TAILOR_FAILED = 'TAILOR_FAILED',
  REVIEW_PENDING = 'REVIEW_PENDING',
  REJECTED = 'REJECTED',
  APPROVED = 'APPROVED',
  APPLYING = 'APPLYING',
  APPLIED = 'APPLIED',
  NEEDS_REVIEW = 'NEEDS_REVIEW',
  FAILED = 'FAILED',
}

/**
 * The only legal moves. APPROVED is reachable solely from REVIEW_PENDING, and
 * APPLYING solely from APPROVED (or a retry after NEEDS_REVIEW/FAILED), which
 * is what makes "nothing is submitted without an approved resume" structural.
 */
export const TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  [ApplicationStatus.MATCHED]: [ApplicationStatus.TAILORING],
  [ApplicationStatus.TAILORING]: [ApplicationStatus.REVIEW_PENDING, ApplicationStatus.TAILOR_FAILED],
  [ApplicationStatus.TAILOR_FAILED]: [ApplicationStatus.TAILORING],
  [ApplicationStatus.REVIEW_PENDING]: [ApplicationStatus.APPROVED, ApplicationStatus.REJECTED, ApplicationStatus.TAILORING],
  [ApplicationStatus.REJECTED]: [ApplicationStatus.TAILORING],
  [ApplicationStatus.APPROVED]: [ApplicationStatus.APPLYING, ApplicationStatus.APPLIED, ApplicationStatus.TAILORING],
  [ApplicationStatus.APPLYING]: [ApplicationStatus.APPLIED, ApplicationStatus.NEEDS_REVIEW, ApplicationStatus.FAILED],
  [ApplicationStatus.NEEDS_REVIEW]: [ApplicationStatus.APPLYING, ApplicationStatus.APPLIED, ApplicationStatus.FAILED],
  [ApplicationStatus.FAILED]: [ApplicationStatus.APPLYING, ApplicationStatus.APPLIED],
  [ApplicationStatus.APPLIED]: [],
};

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** States in which an approved variant exists and may be used to apply or email. */
export const HAS_APPROVED_VARIANT: ApplicationStatus[] = [
  ApplicationStatus.APPROVED,
  ApplicationStatus.APPLYING,
  ApplicationStatus.APPLIED,
  ApplicationStatus.NEEDS_REVIEW,
  ApplicationStatus.FAILED,
];
