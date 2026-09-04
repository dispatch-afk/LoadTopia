import { OfferThreadStatus } from "@loadtopia/shared";

/**
 * Offer negotiation state machine. The individual `OfferRound` rows are
 * immutable; a thread's `status` is the single source of truth for whether a
 * negotiation is live. Clients never set this — only explicit operations
 * (offer / counter / accept / reject / withdraw / expire) drive it, server-side.
 *
 *   ACTIVE → ACCEPTED | REJECTED | WITHDRAWN | EXPIRED   (all terminal)
 */
export type ThreadTransitionMap = Readonly<Record<OfferThreadStatus, readonly OfferThreadStatus[]>>;

export const OFFER_THREAD_TRANSITIONS: ThreadTransitionMap = {
  [OfferThreadStatus.ACTIVE]: [
    OfferThreadStatus.ACCEPTED,
    OfferThreadStatus.REJECTED,
    OfferThreadStatus.WITHDRAWN,
    OfferThreadStatus.EXPIRED,
  ],
  [OfferThreadStatus.ACCEPTED]: [],
  [OfferThreadStatus.REJECTED]: [],
  [OfferThreadStatus.WITHDRAWN]: [],
  [OfferThreadStatus.EXPIRED]: [],
};

export class OfferTransitionError extends Error {
  readonly code = "INVALID_OFFER_TRANSITION";
  readonly statusCode = 409;
  constructor(
    readonly from: OfferThreadStatus,
    readonly to: OfferThreadStatus,
  ) {
    super(`Illegal offer thread transition: ${from} → ${to}`);
    this.name = "OfferTransitionError";
  }
}

export function isThreadActive(status: OfferThreadStatus): boolean {
  return status === OfferThreadStatus.ACTIVE;
}

export function isThreadTerminal(status: OfferThreadStatus): boolean {
  return OFFER_THREAD_TRANSITIONS[status].length === 0;
}

export function canThreadTransition(from: OfferThreadStatus, to: OfferThreadStatus): boolean {
  return OFFER_THREAD_TRANSITIONS[from].includes(to);
}

export function assertThreadTransition(from: OfferThreadStatus, to: OfferThreadStatus): void {
  if (!canThreadTransition(from, to)) throw new OfferTransitionError(from, to);
}
