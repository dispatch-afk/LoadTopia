import { LoadEventType, type LoadStatus } from "@loadtopia/shared";

/**
 * Shape of an immutable load-event row to be persisted whenever something
 * meaningful happens to a load. The persistence layer must treat `load_events`
 * as append-only: no UPDATE, no DELETE.
 */
export interface LoadEventDraft {
  loadId: string;
  type: LoadEventType;
  fromStatus: LoadStatus | null;
  toStatus: LoadStatus | null;
  actorUserId: string | null;
  /**
   * Milestone 3: which company the actor was acting for. Null for every
   * pre-Milestone-3 event type (only the shipper ever wrote one before, so
   * it was never captured) — never backfilled from later, possibly-changed
   * membership state. Mirrors `OfferEvent.actorCompanyId` exactly.
   */
  actorCompanyId: string | null;
  note: string | null;
  data: Record<string, unknown> | null;
}

export function buildStatusChangeEvent(params: {
  loadId: string;
  fromStatus: LoadStatus;
  toStatus: LoadStatus;
  actorUserId: string | null;
  actorCompanyId?: string | null;
  note?: string;
  data?: Record<string, unknown> | null;
}): LoadEventDraft {
  return {
    loadId: params.loadId,
    type: LoadEventType.STATUS_CHANGED,
    fromStatus: params.fromStatus,
    toStatus: params.toStatus,
    actorUserId: params.actorUserId,
    actorCompanyId: params.actorCompanyId ?? null,
    note: params.note ?? null,
    data: params.data ?? null,
  };
}

export function buildLoadUpdatedEvent(params: {
  loadId: string;
  actorUserId: string | null;
  actorCompanyId?: string | null;
  changedFields: string[];
}): LoadEventDraft {
  return {
    loadId: params.loadId,
    type: LoadEventType.UPDATED,
    fromStatus: null,
    toStatus: null,
    actorUserId: params.actorUserId,
    actorCompanyId: params.actorCompanyId ?? null,
    note: null,
    data: { changedFields: params.changedFields },
  };
}

export function buildLoadCreatedEvent(params: {
  loadId: string;
  actorUserId: string | null;
  actorCompanyId?: string | null;
  initialStatus: LoadStatus;
}): LoadEventDraft {
  return {
    loadId: params.loadId,
    type: LoadEventType.CREATED,
    fromStatus: null,
    toStatus: params.initialStatus,
    actorUserId: params.actorUserId,
    actorCompanyId: params.actorCompanyId ?? null,
    note: null,
    data: null,
  };
}

// --- Milestone 3 (Operations) ----------------------------------------------

export function buildNoteAddedEvent(params: {
  loadId: string;
  actorUserId: string | null;
  actorCompanyId: string | null;
  note: string;
}): LoadEventDraft {
  return {
    loadId: params.loadId,
    type: LoadEventType.NOTE_ADDED,
    fromStatus: null,
    toStatus: null,
    actorUserId: params.actorUserId,
    actorCompanyId: params.actorCompanyId,
    note: params.note,
    data: null,
  };
}

export function buildCheckInAddedEvent(params: {
  loadId: string;
  actorUserId: string | null;
  actorCompanyId: string | null;
  checkInId: string;
  city: string;
  state: string;
}): LoadEventDraft {
  return {
    loadId: params.loadId,
    type: LoadEventType.CHECK_IN_ADDED,
    fromStatus: null,
    toStatus: null,
    actorUserId: params.actorUserId,
    actorCompanyId: params.actorCompanyId,
    note: null,
    data: { checkInId: params.checkInId, city: params.city, state: params.state },
  };
}

export function buildDocumentUploadedEvent(params: {
  loadId: string;
  actorUserId: string | null;
  actorCompanyId: string | null;
  documentId: string;
  docType: string;
}): LoadEventDraft {
  return {
    loadId: params.loadId,
    type: LoadEventType.DOCUMENT_UPLOADED,
    fromStatus: null,
    toStatus: null,
    actorUserId: params.actorUserId,
    actorCompanyId: params.actorCompanyId,
    note: null,
    data: { documentId: params.documentId, docType: params.docType },
  };
}

export function buildDocumentReviewedEvent(params: {
  loadId: string;
  actorUserId: string | null;
  actorCompanyId: string | null;
  documentId: string;
  decision: string;
  reason?: string | null;
}): LoadEventDraft {
  return {
    loadId: params.loadId,
    type: LoadEventType.DOCUMENT_REVIEWED,
    fromStatus: null,
    toStatus: null,
    actorUserId: params.actorUserId,
    actorCompanyId: params.actorCompanyId,
    note: null,
    data: {
      documentId: params.documentId,
      decision: params.decision,
      ...(params.reason ? { reason: params.reason } : {}),
    },
  };
}

export function buildDocumentRemovedEvent(params: {
  loadId: string;
  actorUserId: string | null;
  actorCompanyId: string | null;
  documentId: string;
}): LoadEventDraft {
  return {
    loadId: params.loadId,
    type: LoadEventType.DOCUMENT_REMOVED,
    fromStatus: null,
    toStatus: null,
    actorUserId: params.actorUserId,
    actorCompanyId: params.actorCompanyId,
    note: null,
    data: { documentId: params.documentId },
  };
}

export function buildExceptionReportedEvent(params: {
  loadId: string;
  actorUserId: string | null;
  actorCompanyId: string | null;
  category: string;
  note?: string | null;
}): LoadEventDraft {
  return {
    loadId: params.loadId,
    type: LoadEventType.EXCEPTION_REPORTED,
    fromStatus: null,
    toStatus: null,
    actorUserId: params.actorUserId,
    actorCompanyId: params.actorCompanyId,
    note: params.note ?? null,
    data: { category: params.category },
  };
}

// --- Milestone 4 Phase 4 (freight audience strategy) -----------------------
//
// Every payload below carries only FACTS about the audience action itself
// (strategy, stage, counts, timing) — never a private Carrier Group name or
// the identities of other selected carriers. The serializer that turns these
// rows into a carrier-facing timeline is a separate, additional privacy
// boundary (see loads.serializer.ts) — these builders are the server-side
// audit record and may be slightly richer than what a carrier ever sees.

export function buildLoadPostedEvent(params: {
  loadId: string;
  actorUserId: string | null;
  actorCompanyId: string | null;
  strategy: "MARKETPLACE" | "NETWORK_FIRST" | "SELECTED_FIRST";
  audienceCount: number | null;
}): LoadEventDraft {
  const type =
    params.strategy === "MARKETPLACE"
      ? LoadEventType.LOAD_POSTED_TO_MARKETPLACE
      : params.strategy === "NETWORK_FIRST"
        ? LoadEventType.LOAD_POSTED_TO_NETWORK
        : LoadEventType.LOAD_POSTED_TO_SELECTED_CARRIERS;
  return {
    loadId: params.loadId,
    type,
    fromStatus: null,
    toStatus: null,
    actorUserId: params.actorUserId,
    actorCompanyId: params.actorCompanyId,
    note: null,
    data: {
      strategy: params.strategy,
      ...(params.audienceCount != null ? { audienceCount: params.audienceCount } : {}),
    },
  };
}

export function buildReleaseScheduledEvent(params: {
  loadId: string;
  actorUserId: string | null;
  actorCompanyId: string | null;
  toStage: "NETWORK" | "MARKETPLACE";
  releaseAt: string;
}): LoadEventDraft {
  return {
    loadId: params.loadId,
    type:
      params.toStage === "NETWORK"
        ? LoadEventType.NETWORK_RELEASE_SCHEDULED
        : LoadEventType.MARKETPLACE_RELEASE_SCHEDULED,
    fromStatus: null,
    toStatus: null,
    actorUserId: params.actorUserId,
    actorCompanyId: params.actorCompanyId,
    note: null,
    data: { toStage: params.toStage, releaseAt: params.releaseAt },
  };
}

export function buildAudienceReleasedEvent(params: {
  loadId: string;
  actorUserId: string | null;
  actorCompanyId: string | null;
  toStage: "NETWORK" | "MARKETPLACE";
  manual: boolean;
}): LoadEventDraft {
  return {
    loadId: params.loadId,
    type:
      params.toStage === "NETWORK"
        ? LoadEventType.LOAD_RELEASED_TO_NETWORK
        : LoadEventType.LOAD_RELEASED_TO_MARKETPLACE,
    fromStatus: null,
    toStatus: null,
    actorUserId: params.actorUserId,
    actorCompanyId: params.actorCompanyId,
    note: null,
    data: { manual: params.manual },
  };
}

export function buildReleaseRescheduledEvent(params: {
  loadId: string;
  actorUserId: string | null;
  actorCompanyId: string | null;
  toStage: "NETWORK" | "MARKETPLACE";
  releaseAt: string;
}): LoadEventDraft {
  return {
    loadId: params.loadId,
    type: LoadEventType.RELEASE_RESCHEDULED,
    fromStatus: null,
    toStatus: null,
    actorUserId: params.actorUserId,
    actorCompanyId: params.actorCompanyId,
    note: null,
    data: { toStage: params.toStage, releaseAt: params.releaseAt },
  };
}

export function buildReleaseCancelledEvent(params: {
  loadId: string;
  actorUserId: string | null;
  actorCompanyId: string | null;
  toStage: "NETWORK" | "MARKETPLACE";
  reason: string;
}): LoadEventDraft {
  return {
    loadId: params.loadId,
    type: LoadEventType.RELEASE_CANCELLED,
    fromStatus: null,
    toStatus: null,
    actorUserId: params.actorUserId,
    actorCompanyId: params.actorCompanyId,
    note: null,
    data: { toStage: params.toStage, reason: params.reason },
  };
}
