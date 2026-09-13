import type { CompanyType, SharedHistorySummary, SharedLaneView } from "@loadtopia/shared";

/**
 * Presentation-only helpers for the Network workspace. These format or
 * explain BACKEND truth — they never invent a business rule (mirrors the
 * house convention already used in lib/operations.ts).
 */

/** The nav label / page heading differs by company type — same underlying
 *  relationship system either way. */
export function networkAreaLabel(companyType: CompanyType | null): string {
  return companyType === "CARRIER" ? "Connections" : "Carrier Network";
}

export function counterpartNoun(companyType: CompanyType | null): "carrier" | "shipper" {
  return companyType === "CARRIER" ? "shipper" : "carrier";
}

export function laneLabel(lane: Pick<SharedLaneView, "origin" | "destination">): string {
  return `${lane.origin.city}, ${lane.origin.state} → ${lane.destination.city}, ${lane.destination.state}`;
}

/** One factual line summarizing verified shared history — never a score,
 *  never a recommendation. Empty string when there is truthfully nothing to
 *  say yet (a pair with zero shared freight). */
export function sharedHistoryHeadline(summary: SharedHistorySummary): string {
  if (summary.shipmentsTogether === 0) return "";
  const plural = summary.completedShipments === 1 ? "shipment" : "shipments";
  if (summary.completedShipments === 0) {
    return `${summary.shipmentsTogether} shipment${summary.shipmentsTogether === 1 ? "" : "s"} together, in progress`;
  }
  return `${summary.completedShipments} completed ${plural} together`;
}
