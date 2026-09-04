import type { Prisma } from "@loadtopia/db";
import { EXPOSED_LOAD_STATUSES, type LoadEventDraft, assertLoadTransition } from "@loadtopia/domain";
import { LoadStatus } from "@loadtopia/shared";
import { conflict } from "./errors";

/** Append one immutable load_events row (the only way the app writes them). */
export async function appendLoadEvent(
  tx: Prisma.TransactionClient,
  draft: LoadEventDraft,
): Promise<void> {
  await tx.loadEvent.create({
    data: {
      loadId: draft.loadId,
      type: draft.type,
      fromStatus: draft.fromStatus,
      toStatus: draft.toStatus,
      actorUserId: draft.actorUserId,
      note: draft.note,
      data: (draft.data ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

export interface LoadTransitionParams {
  id: string;
  from: LoadStatus;
  to: LoadStatus;
  actorUserId: string;
  extra?: Prisma.LoadUncheckedUpdateManyInput;
  note?: string;
  data?: Record<string, unknown> | null;
}

/**
 * Atomic load status transition inside a transaction. Compare-and-set on
 * `status = from` — under concurrency only one caller wins; the loser gets 409
 * and the whole transaction rolls back. Exactly one STATUS_CHANGED event lands.
 * Returns true (throws on conflict).
 */
export async function atomicLoadTransition(
  tx: Prisma.TransactionClient,
  p: LoadTransitionParams,
): Promise<true> {
  assertLoadTransition(p.from, p.to);
  if (!EXPOSED_LOAD_STATUSES.includes(p.to)) {
    throw conflict("That load transition is not available yet");
  }
  const result = await tx.load.updateMany({
    where: { id: p.id, status: p.from },
    data: { ...p.extra, status: p.to, updatedByUserId: p.actorUserId },
  });
  if (result.count === 0) {
    throw conflict("The load changed while you were working on it. Reload and try again.");
  }
  await appendLoadEvent(tx, {
    loadId: p.id,
    type: "STATUS_CHANGED",
    fromStatus: p.from,
    toStatus: p.to,
    actorUserId: p.actorUserId,
    note: p.note ?? null,
    data: p.data ?? null,
  });
  return true;
}

/**
 * Move `POSTED → OFFER_RECEIVED` on first offer. Idempotent: a no-op (returns
 * false, no event) when the load is already OFFER_RECEIVED because a concurrent
 * offer got there first.
 */
export async function markLoadOfferReceived(
  tx: Prisma.TransactionClient,
  loadId: string,
  actorUserId: string,
): Promise<boolean> {
  const bumped = await tx.load.updateMany({
    where: { id: loadId, status: LoadStatus.POSTED },
    data: { status: LoadStatus.OFFER_RECEIVED, updatedByUserId: actorUserId },
  });
  if (bumped.count === 0) return false;
  await appendLoadEvent(tx, {
    loadId,
    type: "STATUS_CHANGED",
    fromStatus: LoadStatus.POSTED,
    toStatus: LoadStatus.OFFER_RECEIVED,
    actorUserId,
    note: "first marketplace offer received",
    data: null,
  });
  return true;
}
