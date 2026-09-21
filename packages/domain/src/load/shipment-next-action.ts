import { LoadStatus } from "@loadtopia/shared";

/**
 * Deterministic, factual "what happens next" copy for BOTH a Shipments list
 * row and the Shipment Detail guided-next-action banner (Milestone 4 Phase 6
 * unifies what were previously two separate presentation paths — a coarse
 * list-only function here, and a richer ad hoc read of `availableTransitions`
 * /`completionReady` on the web detail page). Purely a function of status +
 * which side is viewing + (at DELIVERED only) the shipment's current POD
 * state — never invents urgency ("hot", "likely late", "priority") and never
 * derives anything from elapsed time. A status outside the shipment
 * lifecycle (DRAFT/POSTED/OFFER_RECEIVED) never reaches this function in
 * practice — see SHIPMENT_LOAD_STATUSES — but returns a plain dash if it
 * somehow does, rather than throwing.
 */
export type ShipmentViewerSide = "shipper" | "carrier";

/**
 * The shipment's current POD state, derived by {@link deriveShipmentPodState}
 * from the load's own document rows — never a new Load status. "NONE" means
 * no confirmed, non-removed POD has been uploaded yet.
 */
export type ShipmentPodState = "NONE" | "PENDING_REVIEW" | "REJECTED" | "APPROVED";

/** Minimal shape {@link deriveShipmentPodState} needs from a document row —
 *  matches the fields already present on `DocumentView` / the Prisma
 *  `LoadDocument` row, so either can be passed directly. */
export interface ShipmentPodFact {
  docType: string;
  reviewStatus: string | null;
  confirmedAt: string | Date | null;
  removedAt: string | Date | null;
  createdAt: string | Date;
}

/**
 * The shipment's current POD state — kept in agreement with the
 * AUTHORITATIVE completion rule (`LoadsService#complete`'s own
 * `findFirst` over every active APPROVED POD, unordered). An APPROVED (or
 * REJECTED) POD is PERMANENT, non-removable evidence once decided (see
 * `DocumentsService#remove`'s terminal-review guard) — nothing in the
 * upload rules prevents a further, unrelated POD from being uploaded
 * afterward (a `replacedDocumentId` is optional and only ever validated
 * against a REJECTED target). So a load can legally carry an already-
 * APPROVED POD *and* a newer PENDING_REVIEW or REJECTED one at the same
 * time — "latest row wins" would then hide a completion the backend
 * already honors. The precedence is therefore:
 *
 *   1. ANY active, confirmed, non-removed POD is APPROVED → "APPROVED",
 *      full stop, regardless of anything uploaded after it.
 *   2. Otherwise, the newest active POD's own review state (PENDING_REVIEW
 *      or REJECTED) — there is at most one meaningfully "current" POD once
 *      APPROVED is ruled out, so recency is the right tiebreaker here.
 *   3. No active POD at all → "NONE".
 *
 * Removed PODs never participate (filtered out first). Order-independent:
 * callers may pass documents in any order.
 */
export function deriveShipmentPodState(documents: readonly ShipmentPodFact[]): ShipmentPodState {
  const activePods = documents.filter(
    (d) => d.docType === "POD" && d.confirmedAt !== null && d.removedAt === null,
  );
  if (activePods.length === 0) return "NONE";
  if (activePods.some((d) => d.reviewStatus === "APPROVED")) return "APPROVED";
  const latest = activePods.reduce((a, b) =>
    new Date(b.createdAt).getTime() > new Date(a.createdAt).getTime() ? b : a,
  );
  return latest.reviewStatus === "REJECTED" ? "REJECTED" : "PENDING_REVIEW";
}

export function shipmentNextAction(
  status: LoadStatus,
  side: ShipmentViewerSide,
  podState: ShipmentPodState = "NONE",
): string {
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
      switch (podState) {
        case "APPROVED":
          return side === "carrier"
            ? "POD approved — awaiting shipper completion"
            : "Complete shipment";
        case "PENDING_REVIEW":
          return side === "carrier" ? "Awaiting shipper POD review" : "Review POD";
        case "REJECTED":
          return side === "carrier" ? "Upload replacement POD" : "Awaiting replacement POD";
        case "NONE":
        default:
          return side === "carrier" ? "Upload POD" : "Awaiting POD";
      }
    case LoadStatus.COMPLETED:
      return "Completed";
    case LoadStatus.CANCELLED:
      return "Cancelled";
    default:
      return "—";
  }
}
