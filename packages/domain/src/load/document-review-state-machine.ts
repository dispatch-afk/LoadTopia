import { DocumentReviewStatus } from "@loadtopia/shared";

/**
 * POD review state machine (Milestone 3). Mirrors `load-state-machine.ts`'s
 * shape exactly, at a much smaller scale: `PENDING_REVIEW` is the only
 * non-terminal state, and a decision — once made — is final for that specific
 * document. There is no path back from `APPROVED` or `REJECTED` to anything;
 * correction is a new `LoadDocument` row (`replacesDocumentId`), never a
 * mutation of the reviewed one.
 */

export type DocumentReviewTransitionMap = Readonly<
  Record<DocumentReviewStatus, readonly DocumentReviewStatus[]>
>;

export const DOCUMENT_REVIEW_TRANSITIONS: DocumentReviewTransitionMap = {
  [DocumentReviewStatus.PENDING_REVIEW]: [
    DocumentReviewStatus.APPROVED,
    DocumentReviewStatus.REJECTED,
  ],
  [DocumentReviewStatus.APPROVED]: [],
  [DocumentReviewStatus.REJECTED]: [],
};

export const TERMINAL_DOCUMENT_REVIEW_STATUSES: readonly DocumentReviewStatus[] = [
  DocumentReviewStatus.APPROVED,
  DocumentReviewStatus.REJECTED,
];

export function isTerminalDocumentReviewStatus(status: DocumentReviewStatus): boolean {
  return TERMINAL_DOCUMENT_REVIEW_STATUSES.includes(status);
}

export class DocumentReviewTransitionError extends Error {
  readonly code = "INVALID_DOCUMENT_REVIEW_TRANSITION";
  constructor(
    readonly from: DocumentReviewStatus,
    readonly to: DocumentReviewStatus,
  ) {
    super(`Illegal document review transition: ${from} → ${to}`);
    this.name = "DocumentReviewTransitionError";
  }
}

export function canTransitionDocumentReview(
  from: DocumentReviewStatus,
  to: DocumentReviewStatus,
): boolean {
  return DOCUMENT_REVIEW_TRANSITIONS[from].includes(to);
}

/** Throws {@link DocumentReviewTransitionError} if the transition is not permitted. */
export function assertDocumentReviewTransition(
  from: DocumentReviewStatus,
  to: DocumentReviewStatus,
): void {
  if (!canTransitionDocumentReview(from, to)) {
    throw new DocumentReviewTransitionError(from, to);
  }
}
