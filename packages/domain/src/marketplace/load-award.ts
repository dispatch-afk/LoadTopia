import { LoadStatus } from "@loadtopia/shared";
import { isExpired } from "./offer-expiration";
import { isThreadActive } from "./offer-state-machine";

/**
 * Pure preconditions for the atomic award operation. The API layer takes a row
 * lock on the load and re-runs these inside the transaction; if any fail the
 * whole transaction rolls back so a load can never end with two winners.
 */

export const AWARDABLE_LOAD_STATUSES: readonly LoadStatus[] = [
  LoadStatus.POSTED,
  LoadStatus.OFFER_RECEIVED,
];

export class AwardError extends Error {
  readonly code: string;
  readonly statusCode: number;
  constructor(code: string, message: string, statusCode = 409) {
    super(message);
    this.name = "AwardError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface AwardCheckInput {
  load: { status: LoadStatus };
  thread: { status: "ACTIVE" | "ACCEPTED" | "REJECTED" | "WITHDRAWN" | "EXPIRED" };
  currentRound: { id: string; expiresAt: Date | string };
  /** The round the acceptor is acting on — must be the thread's current round. */
  acceptedRoundId: string;
  carrierEligibleNow: boolean;
  now?: Date;
}

export function assertAwardable(input: AwardCheckInput): void {
  const now = input.now ?? new Date();

  if (!AWARDABLE_LOAD_STATUSES.includes(input.load.status)) {
    if (input.load.status === LoadStatus.AWARDED || input.load.status === LoadStatus.CARRIER_ASSIGNED) {
      throw new AwardError("LOAD_ALREADY_AWARDED", "This load has already been awarded", 409);
    }
    throw new AwardError("LOAD_NOT_AWARDABLE", "This load is no longer on the marketplace", 409);
  }
  if (!isThreadActive(input.thread.status)) {
    throw new AwardError("OFFER_NOT_ACTIVE", "This offer is no longer active", 409);
  }
  if (input.acceptedRoundId !== input.currentRound.id) {
    throw new AwardError(
      "STALE_ROUND",
      "The negotiation has moved on — reload the current offer",
      409,
    );
  }
  if (isExpired(input.currentRound.expiresAt, now)) {
    throw new AwardError("OFFER_EXPIRED", "This offer has expired and cannot be accepted", 409);
  }
  if (!input.carrierEligibleNow) {
    throw new AwardError(
      "CARRIER_NOT_ELIGIBLE",
      "The carrier is no longer eligible for this load",
      409,
    );
  }
}
