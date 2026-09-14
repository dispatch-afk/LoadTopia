import { LoadStatus } from "@loadtopia/shared";

/**
 * Deterministic, factual "what happens next" copy for a Shipments list row
 * (Milestone 4 Phase 5). Purely a function of status + which side is
 * viewing — never invents urgency ("hot", "likely late", "priority"). A
 * status outside the shipment lifecycle (DRAFT/POSTED/OFFER_RECEIVED) never
 * reaches this function — see SHIPMENT_LOAD_STATUSES.
 */
export type ShipmentViewerSide = "shipper" | "carrier";

export function shipmentNextAction(status: LoadStatus, side: ShipmentViewerSide): string {
  switch (status) {
    case LoadStatus.AWARDED:
      return side === "carrier" ? "Awaiting assignment" : "Confirm carrier assignment";
    case LoadStatus.CARRIER_ASSIGNED:
      return side === "carrier" ? "Confirm pickup" : "Awaiting pickup";
    case LoadStatus.PICKED_UP:
      return side === "carrier" ? "Mark in transit" : "Picked up — awaiting transit update";
    case LoadStatus.IN_TRANSIT:
      return side === "carrier" ? "Mark delivered" : "In transit";
    case LoadStatus.DELIVERED:
      return side === "carrier" ? "Upload POD" : "Review POD";
    case LoadStatus.COMPLETED:
      return "Completed";
    case LoadStatus.CANCELLED:
      return "Cancelled";
    default:
      return "—";
  }
}
