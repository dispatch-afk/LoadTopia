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
  note: string | null;
  data: Record<string, unknown> | null;
}

export function buildStatusChangeEvent(params: {
  loadId: string;
  fromStatus: LoadStatus;
  toStatus: LoadStatus;
  actorUserId: string | null;
  note?: string;
  data?: Record<string, unknown> | null;
}): LoadEventDraft {
  return {
    loadId: params.loadId,
    type: LoadEventType.STATUS_CHANGED,
    fromStatus: params.fromStatus,
    toStatus: params.toStatus,
    actorUserId: params.actorUserId,
    note: params.note ?? null,
    data: params.data ?? null,
  };
}

export function buildLoadUpdatedEvent(params: {
  loadId: string;
  actorUserId: string | null;
  changedFields: string[];
}): LoadEventDraft {
  return {
    loadId: params.loadId,
    type: LoadEventType.UPDATED,
    fromStatus: null,
    toStatus: null,
    actorUserId: params.actorUserId,
    note: null,
    data: { changedFields: params.changedFields },
  };
}

export function buildLoadCreatedEvent(params: {
  loadId: string;
  actorUserId: string | null;
  initialStatus: LoadStatus;
}): LoadEventDraft {
  return {
    loadId: params.loadId,
    type: LoadEventType.CREATED,
    fromStatus: null,
    toStatus: params.initialStatus,
    actorUserId: params.actorUserId,
    note: null,
    data: null,
  };
}
