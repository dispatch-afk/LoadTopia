import type { LoadStatus, LoadView, MeResponse } from "@loadtopia/shared";

/**
 * Frontend read-model for the Milestone 3 operational lifecycle. Every function
 * here formats or explains BACKEND truth — it never invents a business rule.
 * `availableTransitions` and `completionReady` on `LoadView` are already
 * actor-aware (the API filters them per viewer); this module only decides how
 * to present them.
 */

/** Physical shipment progression, in order. `AWARDED` precedes assignment. */
export const OPERATIONAL_STATUSES: LoadStatus[] = [
  "AWARDED",
  "CARRIER_ASSIGNED",
  "PICKED_UP",
  "IN_TRANSIT",
  "DELIVERED",
  "COMPLETED",
];

/** Window in which a carrier may operate the shipment / documents may move
 *  (mirrors the API's `isWithinOperationalActivityWindow`). */
export const OPERATIONAL_ACTIVITY_STATUSES: LoadStatus[] = [
  "CARRIER_ASSIGNED",
  "PICKED_UP",
  "IN_TRANSIT",
  "DELIVERED",
];

const RANK: Partial<Record<LoadStatus, number>> = {
  AWARDED: 0,
  CARRIER_ASSIGNED: 1,
  PICKED_UP: 2,
  IN_TRANSIT: 3,
  DELIVERED: 4,
  COMPLETED: 5,
};

export function isOperationalActivityWindow(status: LoadStatus): boolean {
  return OPERATIONAL_ACTIVITY_STATUSES.includes(status);
}

/**
 * Whether to render the operations experience (progress, check-ins, documents,
 * Rate Confirmation) for this load. True from AWARDED onward, and for a load
 * cancelled after it had already been awarded — never for a draft/posted load
 * that was cancelled before any carrier was involved.
 */
export function shouldShowOperations(load: Pick<LoadView, "status" | "marketplace">): boolean {
  if (OPERATIONAL_STATUSES.includes(load.status)) return true;
  return load.status === "CANCELLED" && load.marketplace.award !== null;
}

export type LoadViewerRole = "shipper" | "carrier" | "admin" | "other";

/**
 * How the signed-in user relates to this load — mirrors the API's
 * `loadViewerRole`. Used only to decide which controls to render; the backend
 * remains the authorization authority for every action.
 */
export function viewerRoleForLoad(me: MeResponse, load: LoadView): LoadViewerRole {
  if (me.role === "ADMIN") return "admin";
  const companyId = me.activeCompanyId;
  if (companyId !== null && companyId === load.shipperCompanyId) return "shipper";
  if (companyId !== null && load.marketplace.award?.carrierCompanyId === companyId) return "carrier";
  return "other";
}

/** Can this user request an operational-document upload on this load? Shipper
 *  with `load:update:own`, or the assigned carrier with
 *  `shipment:operate:assigned` inside the activity window. Backend re-checks. */
export function canUploadDocument(me: MeResponse, load: LoadView): boolean {
  if (!isOperationalActivityWindow(load.status)) return false;
  const role = viewerRoleForLoad(me, load);
  if (role === "admin") return true;
  if (role === "shipper") return me.permissions.includes("load:update:own");
  if (role === "carrier") return me.permissions.includes("shipment:operate:assigned");
  return false;
}

/** Can this user record a manual check-in? Assigned carrier only, in-window. */
export function canRecordCheckIn(me: MeResponse, load: LoadView): boolean {
  return (
    viewerRoleForLoad(me, load) === "carrier" &&
    me.permissions.includes("shipment:operate:assigned") &&
    isOperationalActivityWindow(load.status)
  );
}

/** Can this user review a POD (approve/reject)? Owning shipper only. */
export function canReviewPod(me: MeResponse, load: LoadView): boolean {
  const role = viewerRoleForLoad(me, load);
  return (role === "shipper" || role === "admin") && me.permissions.includes("load:update:own");
}

export type StepState = "done" | "current" | "upcoming";

export interface ProgressStep {
  key: LoadStatus;
  label: string;
  state: StepState;
  /** Real timestamp for this stage, when the model has one. `In transit` has
   *  no timestamp column — it is never fabricated. */
  at: string | null;
}

export interface ShipmentProgress {
  cancelled: boolean;
  cancelledAt: string | null;
  steps: ProgressStep[];
}

/**
 * Derive the stepper purely from load status + the real operational
 * timestamps. `AWARDED` shows an "Awarded" step ahead of "Assigned" and does
 * not imply the carrier is assigned yet. A cancelled load shows what actually
 * happened (stages with a timestamp) plus a cancelled marker — it never shows a
 * "current" stage as though progression continued.
 */
export function shipmentProgress(load: LoadView): ShipmentProgress {
  const cancelled = load.status === "CANCELLED";
  const terminal = load.status === "COMPLETED";
  const currentRank = RANK[load.status] ?? -1;
  const showAwarded = load.status === "AWARDED";

  const rows: Array<{ key: LoadStatus; label: string; at: string | null }> = [];
  if (showAwarded) {
    rows.push({ key: "AWARDED", label: "Awarded", at: load.marketplace.award?.awardedAt ?? null });
  }
  rows.push({
    key: "CARRIER_ASSIGNED",
    label: "Assigned",
    at: load.marketplace.award?.assignedAt ?? null,
  });
  rows.push({ key: "PICKED_UP", label: "Picked up", at: load.pickedUpAt });
  rows.push({ key: "IN_TRANSIT", label: "In transit", at: null });
  rows.push({ key: "DELIVERED", label: "Delivered", at: load.deliveredAt });
  rows.push({ key: "COMPLETED", label: "Completed", at: load.completedAt });

  const steps = rows.map<ProgressStep>((row) => {
    const rank = RANK[row.key] ?? 0;
    let state: StepState;
    if (cancelled) {
      state = row.at ? "done" : "upcoming";
    } else if (rank < currentRank) {
      state = "done";
    } else if (rank === currentRank) {
      state = terminal ? "done" : "current";
    } else {
      state = "upcoming";
    }
    return { key: row.key, label: row.label, state, at: row.at };
  });

  return { cancelled, cancelledAt: load.cancelledAt, steps };
}

// --- Lifecycle actions ------------------------------------------------------

export interface CarrierMovementAction {
  /** The endpoint segment: POST /api/loads/:id/{endpoint} */
  endpoint: "pickup" | "in-transit" | "deliver";
  to: LoadStatus;
  label: string;
  /** Shown in a confirm step for a meaningful, one-way transition. */
  confirm: string | null;
}

/**
 * The single carrier movement action available right now, taken straight from
 * `availableTransitions` (which the API has already filtered to this actor).
 * Returns null when the viewer is not the operating carrier or there is no next
 * movement.
 */
export function carrierMovementAction(load: LoadView): CarrierMovementAction | null {
  const t = load.availableTransitions;
  if (t.includes("PICKED_UP")) {
    return { endpoint: "pickup", to: "PICKED_UP", label: "Confirm pickup", confirm: null };
  }
  if (t.includes("IN_TRANSIT")) {
    return { endpoint: "in-transit", to: "IN_TRANSIT", label: "Start transit", confirm: null };
  }
  if (t.includes("DELIVERED")) {
    return {
      endpoint: "deliver",
      to: "DELIVERED",
      label: "Mark delivered",
      confirm:
        "Marking this load delivered records physical delivery. POD review and shipment completion are separate steps.",
    };
  }
  return null;
}

/** Whether this viewer may complete the shipment now — the API's actor-aware
 *  answer, never re-derived from `status === "DELIVERED"`. */
export function canCompleteShipment(load: LoadView): boolean {
  return load.availableTransitions.includes("COMPLETED");
}

/**
 * Explanatory copy for a DELIVERED shipment that cannot be completed yet
 * because no approved POD exists. Not an error — a normal next step.
 */
export function completionBlockedReason(load: LoadView): string | null {
  if (load.status === "DELIVERED" && !load.completionReady && !canCompleteShipment(load)) {
    return "An approved POD is required before this shipment can be completed.";
  }
  return null;
}

// --- Documents ------------------------------------------------------------

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  BOL: "Bill of Lading (BOL)",
  POD: "Proof of Delivery (POD)",
  OTHER: "Other",
};

export const DOCUMENT_TYPE_SHORT: Record<string, string> = {
  BOL: "BOL",
  POD: "POD",
  OTHER: "Other",
};

export const POD_REVIEW_LABELS: Record<string, string> = {
  PENDING_REVIEW: "Pending review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export function formatFileSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Which party's company uploaded a document, for display. */
export function uploaderLabel(
  uploadedByCompanyId: string,
  shipperCompanyId: string,
  activeCompanyId: string | null,
): string {
  if (activeCompanyId !== null && uploadedByCompanyId === activeCompanyId) return "Your company";
  return uploadedByCompanyId === shipperCompanyId ? "Shipper" : "Carrier";
}

// --- Check-ins ----------------------------------------------------------

/** Format reported coordinates for display. These are MANUALLY reported, never
 *  a GPS fix — callers must label them as such. Returns null when absent. */
export function formatReportedCoordinates(
  latitude: string | null,
  longitude: string | null,
): string | null {
  if (latitude === null || longitude === null) return null;
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

// --- Timeline -----------------------------------------------------------

/** Human-readable label for a load event type, including the M3 additions.
 *  The API never exposes an event's raw `data` blob — only this label, the
 *  actor, and the time are shown. */
export const LOAD_EVENT_LABELS: Record<string, string> = {
  CREATED: "Load created",
  UPDATED: "Load edited",
  STATUS_CHANGED: "Status changed",
  OFFER_CREATED: "Offer created",
  OFFER_ACCEPTED: "Offer accepted",
  OFFER_REJECTED: "Offer rejected",
  NOTE_ADDED: "Note added",
  CANCELLED: "Load cancelled",
  CHECK_IN_ADDED: "Check-in added",
  DOCUMENT_UPLOADED: "Document uploaded",
  DOCUMENT_REVIEWED: "Document reviewed",
  DOCUMENT_REMOVED: "Document removed",
  EXCEPTION_REPORTED: "Exception reported",
};
