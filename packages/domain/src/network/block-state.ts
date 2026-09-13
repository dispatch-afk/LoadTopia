import { CompanyBlockStatus, LoadStatus } from "@loadtopia/shared";

/**
 * Load statuses that represent active, in-progress commercial/operational
 * freight for Block-continuity purposes — from award (AWARDED) through
 * DELIVERED (a POD may still be under review, so the relationship isn't over
 * yet). Excludes:
 *   - COMPLETED (the freight relationship for that load is over)
 *   - CANCELLED (never became real freight, or the parties called it off)
 *   - every pre-award status (DRAFT/POSTED/OFFER_RECEIVED) — no award means
 *     no commercial relationship has formed yet between a specific carrier
 *     and this load; mere marketplace exposure or an unaccepted offer is not
 *     "active freight" between the two companies.
 */
export const ACTIVE_FREIGHT_STATUSES: readonly LoadStatus[] = [
  LoadStatus.AWARDED,
  LoadStatus.CARRIER_ASSIGNED,
  LoadStatus.PICKED_UP,
  LoadStatus.IN_TRANSIT,
  LoadStatus.DELIVERED,
];

export function isActiveFreightStatus(status: LoadStatus): boolean {
  return ACTIVE_FREIGHT_STATUSES.includes(status);
}

/** The status a NEW block episode should be created with, given whether
 *  active freight currently exists between the blocking and blocked company. */
export function initialBlockStatus(hasActiveFreight: boolean): CompanyBlockStatus {
  return hasActiveFreight ? CompanyBlockStatus.PENDING_ON_COMPLETION : CompanyBlockStatus.ACTIVE;
}

/** Whether a block episode currently restricts future interaction (both
 *  PENDING_ON_COMPLETION and ACTIVE are "in force" — only the freight
 *  CONTINUES uninterrupted during PENDING_ON_COMPLETION; the block itself is
 *  already decided and will take full effect once that freight ends). */
export function isBlockInForce(status: CompanyBlockStatus): boolean {
  return status === CompanyBlockStatus.ACTIVE || status === CompanyBlockStatus.PENDING_ON_COMPLETION;
}

/** The status a PENDING_ON_COMPLETION episode moves to once the freight that
 *  was keeping it pending is no longer active (completed or cancelled). */
export function resolvedBlockStatus(): CompanyBlockStatus {
  return CompanyBlockStatus.ACTIVE;
}
