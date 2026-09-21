import { LoadAudienceStage } from "@loadtopia/shared";

/**
 * carrierCanSeeLoad = loadIsPostedAndVisible AND carrierIsEligible AND
 * carrierIsInCurrentAudience
 *
 * This module implements ONLY the third conjunct — audience membership. The
 * first (load status) and second (equipment/service-area/profile
 * eligibility, via `isCarrierEligibleForLoad`) are unchanged, pre-existing
 * Milestone 2 concerns; this composes with them, never replaces them.
 *
 * `hasStrategyRecord: false` is the historical-compatibility case: a load
 * posted before this feature shipped has no `LoadAudienceStrategyRecord`
 * row at all, and behaves exactly as it always did — full marketplace
 * visibility to every otherwise-eligible carrier, no audience restriction.
 *
 * REVIEW CORRECTION (Phase 4 corrections #1/#2): a private-stage snapshot
 * (SELECTED or NETWORK) is HISTORICAL TRUTH — "this carrier was in the
 * audience when this stage was established" — never permanent authorization
 * by itself. Current visibility for EITHER private stage additionally
 * requires a live ACCEPTED Connection right now. A later Disconnect removes
 * current visibility without touching the frozen snapshot row; a later
 * Reconnect restores visibility automatically, with no code change, because
 * `hasAcceptedConnection` simply becomes true again against the SAME
 * unchanged snapshot.
 */
export interface AudienceVisibilityInput {
  hasStrategyRecord: boolean;
  currentStage: LoadAudienceStage | null;
  /** True iff a LoadAudienceMember snapshot row exists for this carrier at
   *  the load's CURRENT stage (SELECTED or NETWORK) — the frozen-membership
   *  half of private-stage visibility. Irrelevant for MARKETPLACE. */
  isCurrentStageMember: boolean;
  /** True iff the carrier currently holds an ACCEPTED Connection with the
   *  shipper — the LIVE, current-authorization half of private-stage
   *  visibility. Required in addition to snapshot membership for BOTH
   *  SELECTED and NETWORK; irrelevant for MARKETPLACE. */
  hasAcceptedConnection: boolean;
  /** True iff an in-force Block (either direction) exists between the two
   *  companies. Always wins — a block excludes visibility at every stage,
   *  including MARKETPLACE and the legacy (no-strategy-record) case. */
  blockInForce: boolean;
}

export function isCarrierInAudience(input: AudienceVisibilityInput): boolean {
  if (input.blockInForce) return false;
  if (!input.hasStrategyRecord) return true;

  switch (input.currentStage) {
    case LoadAudienceStage.MARKETPLACE:
      return true;
    case LoadAudienceStage.NETWORK:
    case LoadAudienceStage.SELECTED:
      // Both private stages require the SAME two things: the carrier was
      // frozen into this stage's snapshot, AND the companies currently hold
      // an ACCEPTED connection. A snapshot alone is history, not authority.
      return input.isCurrentStageMember && input.hasAcceptedConnection;
    default:
      return false;
  }
}
