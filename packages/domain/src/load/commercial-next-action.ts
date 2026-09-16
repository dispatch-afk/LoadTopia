import { LoadStatus } from "@loadtopia/shared";

/**
 * Deterministic, factual "what happens next" copy for a Load in the shipper
 * Coverage Workspace (Milestone 4 Phase 10) — the pre-award counterpart to
 * `shipmentNextAction`, which only covers the shipment lifecycle
 * (AWARDED..COMPLETED). Purely a function of `status` — never invents
 * urgency, never derives anything from elapsed time, never calls a
 * provider. Once a load reaches the shipment lifecycle, this defers to the
 * exact same "Covered — View Shipment" copy for every operational status,
 * pointing the shipper at the existing Shipment Detail rather than
 * continuing to describe covered freight as needing a commercial decision.
 */
export function commercialNextAction(status: LoadStatus): string {
  switch (status) {
    case LoadStatus.DRAFT:
      return "Finish Draft";
    case LoadStatus.POSTED:
      return "Awaiting Coverage";
    case LoadStatus.OFFER_RECEIVED:
      return "Review Offers";
    case LoadStatus.AWARDED:
    case LoadStatus.CARRIER_ASSIGNED:
    case LoadStatus.PICKED_UP:
    case LoadStatus.IN_TRANSIT:
    case LoadStatus.DELIVERED:
      return "Covered — View Shipment";
    case LoadStatus.COMPLETED:
      return "Completed";
    case LoadStatus.CANCELLED:
      return "Cancelled";
    default: {
      // Exhaustiveness guard: a new LoadStatus value fails the build here
      // rather than silently falling through to a misleading default.
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
