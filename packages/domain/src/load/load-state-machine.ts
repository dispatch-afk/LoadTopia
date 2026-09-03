import { LoadStatus } from "@loadtopia/shared";

/**
 * Authoritative load lifecycle state machine.
 *
 * The backend is the ONLY component allowed to change a load's status, and it
 * must route every change through {@link assertTransition}. Clients may express
 * intent (e.g. "post this load") but never set `status` directly.
 *
 * Every applied transition MUST also write an immutable `load_events` row — see
 * `buildStatusChangeEvent`. Those rows are append-only and form the load's audit
 * trail and the raw material for LoadTopia's transaction intelligence.
 */

export type LoadStatusTransitionMap = Readonly<Record<LoadStatus, readonly LoadStatus[]>>;

/**
 * Happy-path flow:
 *   DRAFT → POSTED → OFFER_RECEIVED → AWARDED → CARRIER_ASSIGNED
 *         → PICKED_UP → IN_TRANSIT → DELIVERED → COMPLETED
 *
 * CANCELLED is reachable from any pre-transit state (controlled cancellation).
 * Once freight is physically in motion (PICKED_UP onward) a load can no longer
 * be cancelled — that path will require a dedicated exception/dispute flow in a
 * later milestone.
 */
export const LOAD_STATUS_TRANSITIONS: LoadStatusTransitionMap = {
  [LoadStatus.DRAFT]: [LoadStatus.POSTED, LoadStatus.CANCELLED],
  [LoadStatus.POSTED]: [LoadStatus.OFFER_RECEIVED, LoadStatus.AWARDED, LoadStatus.CANCELLED],
  [LoadStatus.OFFER_RECEIVED]: [LoadStatus.AWARDED, LoadStatus.POSTED, LoadStatus.CANCELLED],
  [LoadStatus.AWARDED]: [LoadStatus.CARRIER_ASSIGNED, LoadStatus.POSTED, LoadStatus.CANCELLED],
  [LoadStatus.CARRIER_ASSIGNED]: [LoadStatus.PICKED_UP, LoadStatus.CANCELLED],
  [LoadStatus.PICKED_UP]: [LoadStatus.IN_TRANSIT],
  [LoadStatus.IN_TRANSIT]: [LoadStatus.DELIVERED],
  [LoadStatus.DELIVERED]: [LoadStatus.COMPLETED],
  [LoadStatus.COMPLETED]: [],
  [LoadStatus.CANCELLED]: [],
};

export const TERMINAL_LOAD_STATUSES: readonly LoadStatus[] = [
  LoadStatus.COMPLETED,
  LoadStatus.CANCELLED,
];

/** Statuses at/after which the freight is considered physically in motion. */
export const IN_MOTION_LOAD_STATUSES: readonly LoadStatus[] = [
  LoadStatus.PICKED_UP,
  LoadStatus.IN_TRANSIT,
  LoadStatus.DELIVERED,
];

export class LoadTransitionError extends Error {
  readonly code = "INVALID_LOAD_TRANSITION";
  constructor(
    readonly from: LoadStatus,
    readonly to: LoadStatus,
  ) {
    super(`Illegal load status transition: ${from} → ${to}`);
    this.name = "LoadTransitionError";
  }
}

export function nextLoadStatuses(from: LoadStatus): readonly LoadStatus[] {
  return LOAD_STATUS_TRANSITIONS[from];
}

export function isTerminalLoadStatus(status: LoadStatus): boolean {
  return TERMINAL_LOAD_STATUSES.includes(status);
}

export function canTransitionLoad(from: LoadStatus, to: LoadStatus): boolean {
  return LOAD_STATUS_TRANSITIONS[from].includes(to);
}

/** Throws {@link LoadTransitionError} if the transition is not permitted. */
export function assertLoadTransition(from: LoadStatus, to: LoadStatus): void {
  if (!canTransitionLoad(from, to)) {
    throw new LoadTransitionError(from, to);
  }
}

export function canCancelLoad(from: LoadStatus): boolean {
  return canTransitionLoad(from, LoadStatus.CANCELLED);
}
