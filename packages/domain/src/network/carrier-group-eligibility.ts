import { type CompanyBlockStatus, ConnectionStatus } from "@loadtopia/shared";
import { isBlockInForce } from "./block-state";

export type CarrierGroupIneligibilityReason = "NOT_CONNECTED" | "BLOCKED";

export interface CarrierGroupEligibilityInput {
  /** The shipper<->carrier Connection's current status, or null if none
   *  exists. */
  connectionStatus: ConnectionStatus | null;
  /** An in-force Block between the two companies, in EITHER direction, or
   *  null if none exists. Direction doesn't matter for eligibility — a block
   *  either way means the shipper should not be adding this carrier to a
   *  group it uses to route future freight. */
  blockStatus: CompanyBlockStatus | null;
}

export interface CarrierGroupEligibilityResult {
  eligible: boolean;
  reason?: CarrierGroupIneligibilityReason;
}

/**
 * Pure eligibility rule for adding a carrier company to a shipper's Carrier
 * Group. No DB I/O — the caller resolves connection/block state first and
 * passes it in. Requires an ACCEPTED Connection and no in-force Block.
 */
export function canAddCarrierToGroup(
  input: CarrierGroupEligibilityInput,
): CarrierGroupEligibilityResult {
  if (input.blockStatus !== null && isBlockInForce(input.blockStatus)) {
    return { eligible: false, reason: "BLOCKED" };
  }
  if (input.connectionStatus !== ConnectionStatus.ACCEPTED) {
    return { eligible: false, reason: "NOT_CONNECTED" };
  }
  return { eligible: true };
}
