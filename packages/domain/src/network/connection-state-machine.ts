import { ConnectionStatus } from "@loadtopia/shared";
import { NetworkError } from "./errors";

export type ConnectionAction = "REQUEST" | "ACCEPT" | "DECLINE" | "DISCONNECT";

/** `null` means "no CompanyConnection row exists yet" — the conceptual NONE
 *  state from the product spec, which is never itself stored. */
export type ConnectionCurrentState = ConnectionStatus | null;

/**
 * Valid lifecycle:
 *   NONE          -> PENDING       (REQUEST)
 *   PENDING       -> ACCEPTED      (ACCEPT, responder only)
 *   PENDING       -> DECLINED      (DECLINE, responder only)
 *   ACCEPTED      -> DISCONNECTED  (DISCONNECT)
 *   DECLINED      -> PENDING       (REQUEST, i.e. re-request)
 *   DISCONNECTED  -> PENDING       (REQUEST, i.e. re-request)
 *
 * Deliberately NOT supported in Phase 2 (no such action exists yet):
 *   - a requester withdrawing their own still-PENDING request
 *   - PENDING -> DISCONNECTED (nothing to disconnect until accepted)
 *   - DECLINED -> ACCEPTED directly (must re-request first)
 */
const ALLOWED_FROM: Record<ConnectionAction, readonly ConnectionCurrentState[]> = {
  REQUEST: [null, ConnectionStatus.DECLINED, ConnectionStatus.DISCONNECTED],
  ACCEPT: [ConnectionStatus.PENDING],
  DECLINE: [ConnectionStatus.PENDING],
  DISCONNECT: [ConnectionStatus.ACCEPTED],
};

const RESULT_STATUS: Record<ConnectionAction, ConnectionStatus> = {
  REQUEST: ConnectionStatus.PENDING,
  ACCEPT: ConnectionStatus.ACCEPTED,
  DECLINE: ConnectionStatus.DECLINED,
  DISCONNECT: ConnectionStatus.DISCONNECTED,
};

export function canTransitionConnection(
  current: ConnectionCurrentState,
  action: ConnectionAction,
): boolean {
  return ALLOWED_FROM[action].includes(current);
}

/** Validate + resolve the resulting status, or throw a {@link NetworkError}. */
export function assertValidConnectionTransition(
  current: ConnectionCurrentState,
  action: ConnectionAction,
): ConnectionStatus {
  if (!canTransitionConnection(current, action)) {
    const from = current ?? "no existing connection";
    throw new NetworkError(`Cannot ${action.toLowerCase()} from ${from}`);
  }
  return RESULT_STATUS[action];
}

/** Only the company that did NOT initiate a pending request may accept or
 *  decline it — the requester cannot "accept" their own request. */
export function canRespondToConnection(actorCompanyId: string, requesterCompanyId: string): boolean {
  return actorCompanyId !== requesterCompanyId;
}
