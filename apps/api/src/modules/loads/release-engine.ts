import type { Prisma, PrismaClient } from "@loadtopia/db";
import {
  assertCanModifyLoad,
  assertPermission,
  buildAudienceReleasedEvent,
  buildReleaseCancelledEvent,
  buildReleaseRescheduledEvent,
  isForwardStage,
  MARKETPLACE_VISIBLE_STATUSES,
  Permission,
  stageOrdinal,
} from "@loadtopia/domain";
import { type AuthenticatedActor, LoadReleaseStatus } from "@loadtopia/shared";
import { appendLoadEvent } from "../../lib/load-lifecycle";
import { conflict, notFound } from "../../lib/errors";
import { freezeAudienceSnapshot, resolveEligibleNetworkCarriers } from "./audience.query";

type Tx = Prisma.TransactionClient;

/**
 * Freight audience release engine (Milestone 4 Phase 4).
 *
 * DATABASE-ENFORCED chain ordering (review correction #3): every
 * `LoadAudienceRelease` row records the exact `fromStage` its OWN execution
 * requires the strategy's authoritative `currentStage` to equal (derived
 * once, at creation, from the release's position in the chain — see
 * AudienceService#applyAudienceAtPosting). {@link executeOneRelease} checks
 * this with an EXACT equality comparison, never "forward enough" — so
 * correctness never depends on process-local ordering, a single poller
 * instance, `findMany` ORDER BY, or poll timing. If a later chained release
 * (e.g. NETWORK -> MARKETPLACE) is attempted before its predecessor
 * (SELECTED -> NETWORK) has actually committed, `fromStage` will not yet
 * match `currentStage`: the row is left untouched in PENDING — never
 * permanently consumed or cancelled just for being tried early — so a later
 * poll (on this or any other instance) retries it once the predecessor has
 * committed. This eliminates the multi-instance mis-ordering race the
 * original design only documented as "safety-neutral" — see the Phase 4
 * corrections report.
 */
export async function cancelPendingReleases(
  tx: Tx,
  loadId: string,
  reason: "load_covered" | "load_cancelled",
  actorUserId: string | null,
  actorCompanyId: string | null,
): Promise<void> {
  const pending = await tx.loadAudienceRelease.findMany({
    where: { loadId, status: LoadReleaseStatus.PENDING },
    select: { id: true, toStage: true },
    orderBy: { scheduledAt: "asc" },
  });
  const earliest = pending[0];
  if (!earliest) return;

  const now = new Date();
  await tx.loadAudienceRelease.updateMany({
    where: { id: { in: pending.map((p) => p.id) } },
    data: { status: LoadReleaseStatus.CANCELLED, cancelledAt: now, cancelReason: reason },
  });
  // One consolidated event, not one per row — the earliest pending stage is
  // the meaningful fact ("the network release that was coming never happened").
  await appendLoadEvent(
    tx,
    buildReleaseCancelledEvent({
      loadId,
      actorUserId,
      actorCompanyId,
      toStage: earliest.toStage as "NETWORK" | "MARKETPLACE",
      reason,
    }),
  );
}

/**
 * Executes ONE due release inside its own transaction.
 *
 * Claim mechanism: `SELECT ... FOR UPDATE` locks THIS SPECIFIC release row
 * only if it is still `PENDING`. Under Postgres READ COMMITTED semantics, a
 * second concurrent transaction attempting the SAME row blocks on that lock;
 * once the first transaction commits, the second's statement re-evaluates
 * its `WHERE status = 'PENDING'` filter against the now-committed row and
 * finds zero matches (status is no longer PENDING) — so it safely no-ops.
 * This is the standard, well-known "claim a specific row" pattern and needs
 * no additional locking primitive beyond the transaction itself.
 *
 * Stage-ordering check: the authoritative `currentStage` must EXACTLY equal
 * this release's `fromStage`. Three outcomes:
 *   - exact match, load still eligible → EXECUTE (advance stage, freeze the
 *     NETWORK snapshot if this hop moves the load INTO Network, mark
 *     RELEASED, write exactly one event).
 *   - load no longer eligible (covered/cancelled) → permanently CANCEL.
 *   - mismatch, but `toStage` is still forward of `currentStage` → the
 *     predecessor hop has not executed yet: leave the row PENDING,
 *     untouched, for a later retry (never cancelled, never "released" early).
 *   - mismatch, and `toStage` is NOT forward of `currentStage` → this
 *     release has been superseded by a manual Release Now that already
 *     passed it: permanently CANCEL.
 */
export async function executeOneRelease(
  prisma: PrismaClient,
  releaseId: string,
  now: Date,
): Promise<"released" | "cancelled" | "skipped"> {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM load_audience_releases
      WHERE id = ${releaseId}::uuid AND status = 'PENDING'
      FOR UPDATE
    `;
    if (claimed.length === 0) return "skipped";

    const release = await tx.loadAudienceRelease.findUniqueOrThrow({
      where: { id: releaseId },
      select: { loadId: true, strategyId: true, fromStage: true, toStage: true },
    });

    await tx.$executeRaw`SELECT 1 FROM loads WHERE id = ${release.loadId}::uuid FOR UPDATE`;
    const [load, strategy] = await Promise.all([
      tx.load.findUniqueOrThrow({ where: { id: release.loadId }, select: { status: true } }),
      tx.loadAudienceStrategyRecord.findUniqueOrThrow({
        where: { id: release.strategyId },
        select: { currentStage: true, load: { select: { shipperCompanyId: true } } },
      }),
    ]);

    if (!MARKETPLACE_VISIBLE_STATUSES.includes(load.status)) {
      await tx.loadAudienceRelease.update({
        where: { id: releaseId },
        data: {
          status: LoadReleaseStatus.CANCELLED,
          cancelledAt: now,
          cancelReason: "load_ineligible",
        },
      });
      return "cancelled";
    }

    if (strategy.currentStage !== release.fromStage) {
      if (isForwardStage(strategy.currentStage, release.toStage)) {
        // The predecessor hop for this chain hasn't executed yet — leave
        // this row exactly as it is (still PENDING) so a later poll (on
        // this or any other instance) retries it once that hop commits.
        return "skipped";
      }
      // currentStage has already reached or passed this release's target —
      // a manual Release Now superseded it. Permanently cancel.
      await tx.loadAudienceRelease.update({
        where: { id: releaseId },
        data: {
          status: LoadReleaseStatus.CANCELLED,
          cancelledAt: now,
          cancelReason: "superseded_by_manual_release",
        },
      });
      return "cancelled";
    }

    if (release.toStage === "NETWORK") {
      const eligible = await resolveEligibleNetworkCarriers(tx, strategy.load.shipperCompanyId);
      await freezeAudienceSnapshot(
        tx,
        release.loadId,
        release.strategyId,
        "NETWORK",
        [...eligible].map(([companyId, companyName]) => ({
          companyId,
          companyName,
          sourceGroupId: null,
          sourceGroupName: null,
        })),
      );
    }

    await tx.loadAudienceStrategyRecord.update({
      where: { id: release.strategyId },
      data: { currentStage: release.toStage },
    });
    await tx.loadAudienceRelease.update({
      where: { id: releaseId },
      data: { status: LoadReleaseStatus.RELEASED, executedAt: now },
    });
    await appendLoadEvent(
      tx,
      buildAudienceReleasedEvent({
        loadId: release.loadId,
        actorUserId: null,
        actorCompanyId: strategy.load.shipperCompanyId,
        toStage: release.toStage as "NETWORK" | "MARKETPLACE",
        manual: false,
      }),
    );
    return "released";
  });
}

export interface ReleaseEngineResult {
  claimed: number;
  released: number;
  cancelled: number;
}

/** One poll tick: claim and execute a bounded batch of due releases. Safe to
 *  call from a timer, a test, or a manual trigger — idempotent and
 *  concurrency-safe per {@link executeOneRelease}. A row skipped because its
 *  predecessor hasn't executed yet remains due (`scheduledAt <= now`) and is
 *  simply picked up again on the next tick — no special retry bookkeeping
 *  needed. */
export async function processDueReleases(
  prisma: PrismaClient,
  opts: { batchSize?: number; now?: Date } = {},
): Promise<ReleaseEngineResult> {
  const now = opts.now ?? new Date();
  const due = await prisma.loadAudienceRelease.findMany({
    where: { status: LoadReleaseStatus.PENDING, scheduledAt: { lte: now } },
    select: { id: true },
    orderBy: { scheduledAt: "asc" },
    take: opts.batchSize ?? 25,
  });

  const result: ReleaseEngineResult = { claimed: due.length, released: 0, cancelled: 0 };
  for (const row of due) {
    const outcome = await executeOneRelease(prisma, row.id, now);
    if (outcome === "released") result.released++;
    else if (outcome === "cancelled") result.cancelled++;
  }
  return result;
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;

/** Starts the lightweight in-process poller. DB rows remain the source of
 *  truth throughout — a process restart just means the next tick re-queries
 *  PENDING rows; nothing is lost. Call the returned `stop()` on shutdown. */
export function startReleasePoller(
  prisma: PrismaClient,
  log: { warn: (obj: unknown, msg: string) => void },
  intervalMs: number = DEFAULT_POLL_INTERVAL_MS,
): { stop: () => void } {
  const timer = setInterval(() => {
    processDueReleases(prisma).catch((err) => {
      log.warn({ err }, "release engine poll failed");
    });
  }, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}

// ── Manual, shipper-driven actions (Load detail / coverage workspace) ──────

async function loadAndStrategyForActor(
  tx: Tx,
  actor: AuthenticatedActor,
  loadId: string,
) {
  const load = await tx.load.findUnique({ where: { id: loadId } });
  if (!load) throw notFound("Load not found");
  assertCanModifyLoad(actor, load);
  const strategy = await tx.loadAudienceStrategyRecord.findUnique({ where: { loadId } });
  if (!strategy) {
    throw conflict("This load has no recorded audience strategy to manage");
  }
  return { load, strategy };
}

/** Release to a later stage immediately — may skip a stage (e.g. Selected
 *  straight to Marketplace), unlike the automatic chain which only ever
 *  advances one hop at a time. Cancels any now-superseded pending releases.
 *  Freezes the NETWORK snapshot at THIS moment if jumping into Network. */
export async function releaseNow(
  prisma: PrismaClient,
  actor: AuthenticatedActor,
  loadId: string,
  target: "NETWORK" | "MARKETPLACE",
): Promise<void> {
  assertPermission(actor, Permission.LOAD_UPDATE_OWN);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM loads WHERE id = ${loadId}::uuid FOR UPDATE`;
    const { load, strategy } = await loadAndStrategyForActor(tx, actor, loadId);

    if (!MARKETPLACE_VISIBLE_STATUSES.includes(load.status)) {
      throw conflict("This load is no longer eligible for audience release");
    }
    if (!isForwardStage(strategy.currentStage, target)) {
      throw conflict("This load has already reached or passed that audience stage");
    }

    const superseded = await tx.loadAudienceRelease.findMany({
      where: { loadId, status: LoadReleaseStatus.PENDING },
      select: { id: true },
    });
    if (superseded.length > 0) {
      await tx.loadAudienceRelease.updateMany({
        where: { id: { in: superseded.map((s) => s.id) } },
        data: {
          status: LoadReleaseStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: "superseded_by_manual_release",
        },
      });
    }

    if (target === "NETWORK") {
      const eligible = await resolveEligibleNetworkCarriers(tx, load.shipperCompanyId);
      await freezeAudienceSnapshot(
        tx,
        loadId,
        strategy.id,
        "NETWORK",
        [...eligible].map(([companyId, companyName]) => ({
          companyId,
          companyName,
          sourceGroupId: null,
          sourceGroupName: null,
        })),
      );
    }

    await tx.loadAudienceStrategyRecord.update({
      where: { id: strategy.id },
      data: { currentStage: target, autoReleaseDisabled: false },
    });
    await appendLoadEvent(
      tx,
      buildAudienceReleasedEvent({
        loadId,
        actorUserId: actor.userId,
        actorCompanyId: actor.companyId,
        toStage: target,
        manual: true,
      }),
    );
  });
}

export async function rescheduleRelease(
  prisma: PrismaClient,
  actor: AuthenticatedActor,
  loadId: string,
  releaseId: string,
  newReleaseAt: Date,
): Promise<void> {
  assertPermission(actor, Permission.LOAD_UPDATE_OWN);

  await prisma.$transaction(async (tx) => {
    const { load } = await loadAndStrategyForActor(tx, actor, loadId);
    if (!MARKETPLACE_VISIBLE_STATUSES.includes(load.status)) {
      throw conflict("This load is no longer eligible for audience release");
    }
    const release = await tx.loadAudienceRelease.findUnique({
      where: { id: releaseId },
      select: { id: true, loadId: true, status: true, toStage: true },
    });
    if (!release || release.loadId !== loadId) throw notFound("Scheduled release not found");
    if (release.status !== LoadReleaseStatus.PENDING) {
      throw conflict("Only a pending scheduled release can be rescheduled");
    }
    if (newReleaseAt.getTime() <= Date.now()) {
      throw conflict("A rescheduled release must be in the future");
    }

    await tx.loadAudienceRelease.update({
      where: { id: releaseId },
      data: { scheduledAt: newReleaseAt },
    });
    await appendLoadEvent(
      tx,
      buildReleaseRescheduledEvent({
        loadId,
        actorUserId: actor.userId,
        actorCompanyId: actor.companyId,
        toStage: release.toStage as "NETWORK" | "MARKETPLACE",
        releaseAt: newReleaseAt.toISOString(),
      }),
    );
  });
}

export async function cancelScheduledRelease(
  prisma: PrismaClient,
  actor: AuthenticatedActor,
  loadId: string,
  releaseId: string,
): Promise<void> {
  assertPermission(actor, Permission.LOAD_UPDATE_OWN);

  await prisma.$transaction(async (tx) => {
    const { strategy } = await loadAndStrategyForActor(tx, actor, loadId);
    const release = await tx.loadAudienceRelease.findUnique({
      where: { id: releaseId },
      select: { id: true, loadId: true, status: true, toStage: true },
    });
    if (!release || release.loadId !== loadId) throw notFound("Scheduled release not found");
    if (release.status !== LoadReleaseStatus.PENDING) {
      throw conflict("Only a pending scheduled release can be cancelled");
    }

    const now = new Date();
    // Cancelling a stage also cancels anything chained AFTER it — it could
    // never legally fire once its prerequisite hop is gone.
    const chained = await tx.loadAudienceRelease.findMany({
      where: { loadId, status: LoadReleaseStatus.PENDING },
      select: { id: true, toStage: true },
    });
    const toCancel = chained.filter(
      (c) => c.id === releaseId || stageOrdinal(c.toStage) > stageOrdinal(release.toStage),
    );
    await tx.loadAudienceRelease.updateMany({
      where: { id: { in: toCancel.map((c) => c.id) } },
      data: {
        status: LoadReleaseStatus.CANCELLED,
        cancelledAt: now,
        cancelReason: toCancel.length > 1 ? "prerequisite_cancelled" : "shipper_cancelled",
      },
    });
    // The row the shipper actually targeted always gets its own precise reason.
    await tx.loadAudienceRelease.update({
      where: { id: releaseId },
      data: { cancelReason: "shipper_cancelled" },
    });

    await tx.loadAudienceStrategyRecord.update({
      where: { id: strategy.id },
      data: { autoReleaseDisabled: true },
    });
    await appendLoadEvent(
      tx,
      buildReleaseCancelledEvent({
        loadId,
        actorUserId: actor.userId,
        actorCompanyId: actor.companyId,
        toStage: release.toStage as "NETWORK" | "MARKETPLACE",
        reason: "shipper_cancelled",
      }),
    );
  });
}
