import type { CarrierAttentionKind, ShipperAttentionKind } from "@loadtopia/shared";

/** Factual copy only — no urgency/priority/scarcity language. Matches the
 *  vocabulary `shipmentNextAction` already uses (Milestone 4 Phase 6). */
export const SHIPPER_ATTENTION_LABEL: Record<ShipperAttentionKind, string> = {
  NEEDS_COVERAGE: "Needs Coverage",
  POD_AWAITING_REVIEW: "POD Awaiting Review",
  READY_TO_COMPLETE: "Ready to Complete",
  // Neutral wording: a rejected POD needs a REPLACEMENT from the carrier —
  // this is shipment awareness for the shipper, never phrased as the
  // shipper's own action (Phase 8 §8/§9).
  REPLACEMENT_POD_NEEDED: "Replacement POD Needed",
};

/** Needs Coverage spans POSTED + OFFER_RECEIVED, which the Loads page
 *  cannot yet filter to in one status param — link to the unfiltered list
 *  rather than a single-status URL that would understate the count shown
 *  next to it (Phase 8 §16). */
export const SHIPPER_ATTENTION_HREF: Record<ShipperAttentionKind, string> = {
  NEEDS_COVERAGE: "/loads",
  POD_AWAITING_REVIEW: "/shipments",
  READY_TO_COMPLETE: "/shipments",
  REPLACEMENT_POD_NEEDED: "/shipments",
};

export const CARRIER_ATTENTION_LABEL: Record<CarrierAttentionKind, string> = {
  AWAITING_MY_RESPONSE: "Awaiting My Response",
  AWAITING_PICKUP: "Awaiting Pickup",
  READY_FOR_TRANSIT_UPDATE: "Ready for Transit Update",
  AWAITING_DELIVERY_CONFIRMATION: "Awaiting Delivery Confirmation",
  POD_NEEDED: "POD Needed",
  REPLACEMENT_POD_NEEDED: "Replacement POD Needed",
};

export const CARRIER_ATTENTION_HREF: Record<CarrierAttentionKind, string> = {
  AWAITING_MY_RESPONSE: "/marketplace/offers",
  AWAITING_PICKUP: "/my-shipments",
  READY_FOR_TRANSIT_UPDATE: "/my-shipments",
  AWAITING_DELIVERY_CONFIRMATION: "/my-shipments",
  POD_NEEDED: "/my-shipments",
  REPLACEMENT_POD_NEEDED: "/my-shipments",
};
