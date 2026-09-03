import type { Prisma, PrismaClient } from "@loadtopia/db";
import {
  assertAwardable,
  assertCanRespond,
  assertPermission,
  assertThreadTransition,
  carrierMarketplaceAccess,
  computeExpiry,
  isCarrierEligibleForLoad,
  isLoadOnMarket,
  isThreadActive,
  MARKETPLACE_VISIBLE_STATUSES,
  Permission,
  respondingParty,
  type RoundContext,
} from "@loadtopia/domain";
import {
  type AuthenticatedActor,
  type CloseThreadInput,
  type CounterOfferInput,
  type CreateOfferInput,
  LoadStatus,
  type OfferThreadSummary,
  type OfferThreadView,
  type Paginated,
  type Pagination,
} from "@loadtopia/shared";
import { AppError, conflict, forbidden, notFound } from "../../lib/errors";
import { loadCarrierEligibilityContext } from "../../lib/carrier-context";
import { atomicLoadTransition, markLoadOfferReceived } from "../../lib/load-lifecycle";
import { toDecimal } from "../../lib/money";
import { paginate, toSkipTake } from "../../lib/pagination";
import {
  threadDetailInclude,
  threadSummaryInclude,
  toThreadSummary,
  toThreadView,
  type ViewerParty,
} from "./offer.serializer";

type Tx = Prisma.TransactionClient;
type OfferEventKind = "CREATED" | "COUNTERED" | "ACCEPTED" | "REJECTED" | "WITHDRAWN" | "EXPIRED";

/**
 * Offers & negotiation. Every state-changing operation is an explicit method
 * (never a generic PATCH): create → counter → accept / reject / withdraw, plus
 * lazy expiry. `OfferRound` rows are immutable (DB trigger + append-only); a
 * thread's `status` is the single source of truth for whether it is live.
 *
 * Concurrency: {@link accept} performs the ATOMIC LOAD AWARD — a `SELECT … FOR
 * UPDATE` row lock on the load, a re-check of every precondition inside the
 * transaction, and a compare-and-set load transition. Two carriers accepting
 * concurrently can never both win.
 */
export class OffersService {
  constructor(private readonly prisma: PrismaClient) {}

  // ── low-level helpers ────────────────────────────────────────────────

  private async lockLoad(tx: Tx, loadId: string): Promise<void> {
    await tx.$executeRaw`SELECT 1 FROM loads WHERE id = ${loadId}::uuid FOR UPDATE`;
  }

  private async lockThread(tx: Tx, threadId: string): Promise<void> {
    await tx.$executeRaw`SELECT 1 FROM offer_threads WHERE id = ${threadId}::uuid FOR UPDATE`;
  }

  private async appendOfferEvent(
    tx: Tx,
    e: {
      threadId: string;
      roundId?: string | null;
      type: OfferEventKind;
      actorUserId: string | null;
      actorCompanyId: string | null;
      data?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    await tx.offerEvent.create({
      data: {
        threadId: e.threadId,
        roundId: e.roundId ?? null,
        type: e.type,
        actorUserId: e.actorUserId,
        actorCompanyId: e.actorCompanyId,
        // Payloads carry only commercial facts — never secrets/tokens/PII.
        data: (e.data ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  /**
   * Lazy-expire one ACTIVE thread whose current round has passed its deadline.
   * Safe to call inside any transaction; a no-op otherwise. Returns whether it
   * transitioned the thread.
   */
  private async expireIfStale(
    tx: Tx,
    thread: { id: string; status: string; currentRoundId: string | null },
    currentRound: { expiresAt: Date } | null,
    now: Date,
  ): Promise<boolean> {
    if (
      thread.status !== "ACTIVE" ||
      !currentRound ||
      currentRound.expiresAt.getTime() > now.getTime()
    ) {
      return false;
    }
    const done = await tx.offerThread.updateMany({
      where: { id: thread.id, status: "ACTIVE" },
      data: { status: "EXPIRED", closedReason: "offer expired", closedAt: now },
    });
    if (done.count === 0) return false;
    await this.appendOfferEvent(tx, {
      threadId: thread.id,
      roundId: thread.currentRoundId,
      type: "EXPIRED",
      actorUserId: null,
      actorCompanyId: null,
      data: { at: now.toISOString() },
    });
    return true;
  }

  /** Lazy-expire a set of threads in one short transaction (used before reads). */
  private async sweepThreads(threadIds: string[]): Promise<void> {
    if (threadIds.length === 0) return;
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const threads = await tx.offerThread.findMany({
        where: { id: { in: threadIds }, status: "ACTIVE" },
        select: {
          id: true,
          status: true,
          currentRoundId: true,
          currentRound: { select: { expiresAt: true } },
        },
      });
      for (const t of threads) await this.expireIfStale(tx, t, t.currentRound, now);
    });
  }

  private viewerParty(
    actor: AuthenticatedActor,
    carrierCompanyId: string,
    shipperCompanyId: string,
  ): ViewerParty | null {
    if (actor.role === "ADMIN") return "ADMIN";
    if (actor.companyId && actor.companyId === carrierCompanyId) return "CARRIER";
    if (actor.companyId && actor.companyId === shipperCompanyId) return "SHIPPER";
    return null;
  }

  private roundCtx(
    carrierCompanyId: string,
    shipperCompanyId: string,
    proposedByCompanyId: string,
  ): RoundContext {
    return {
      proposedByCompanyId,
      loadShipperCompanyId: shipperCompanyId,
      threadCarrierCompanyId: carrierCompanyId,
    };
  }

  /** Carrier responds via offer:create; shipper via offer:respond; admin never. */
  private assertRespondPermission(actor: AuthenticatedActor, viewer: ViewerParty): void {
    if (viewer === "CARRIER") {
      assertPermission(actor, Permission.OFFER_CREATE);
    } else if (viewer === "SHIPPER") {
      assertPermission(actor, Permission.OFFER_RESPOND);
    } else {
      throw forbidden();
    }
  }

  private async threadViewById(threadId: string, viewer: ViewerParty): Promise<OfferThreadView> {
    const full = await this.prisma.offerThread.findUniqueOrThrow({
      where: { id: threadId },
      include: threadDetailInclude,
    });
    return toThreadView(full, viewer);
  }

  // ── carrier: create an offer ─────────────────────────────────────────

  async createOffer(
    actor: AuthenticatedActor,
    loadId: string,
    input: CreateOfferInput,
  ): Promise<{ thread: OfferThreadView; created: boolean }> {
    assertPermission(actor, Permission.OFFER_CREATE);
    const carrierCompanyId = actor.companyId;
    if (!carrierCompanyId) throw forbidden();

    const load = await this.prisma.load.findUnique({
      where: { id: loadId },
      select: {
        status: true,
        equipmentType: true,
        origin: { select: { state: true } },
      },
    });
    // IDOR-safe: a DRAFT / private / cancelled / awarded load is simply "not found"
    // to a carrier — they can only reach loads that are on the marketplace.
    if (!load || !MARKETPLACE_VISIBLE_STATUSES.includes(load.status)) {
      throw notFound("Load not found");
    }

    const carrierCtx = await loadCarrierEligibilityContext(this.prisma, carrierCompanyId);
    const access = carrierMarketplaceAccess(carrierCtx, actor.role);
    if (!access.eligible) {
      throw new AppError(
        403,
        "CARRIER_NOT_ELIGIBLE",
        "Your company is not eligible to use the marketplace",
        { reasons: access.reasons },
      );
    }
    const elig = isCarrierEligibleForLoad(carrierCtx, {
      status: load.status,
      equipmentType: load.equipmentType,
      originState: load.origin.state,
    });
    if (!elig.eligible) {
      throw new AppError(403, "NOT_ELIGIBLE_FOR_LOAD", "You are not eligible to offer on this load", {
        reasons: elig.reasons,
      });
    }

    // One negotiation per carrier per load (DB: @@unique([loadId, carrierCompanyId])).
    const existing = await this.prisma.offerThread.findUnique({
      where: { loadId_carrierCompanyId: { loadId, carrierCompanyId } },
      include: { currentRound: true },
    });
    if (existing) {
      if (existing.status !== "ACTIVE") {
        throw conflict("Your negotiation on this load is already closed");
      }
      const cur = existing.currentRound;
      const idempotentReplay =
        existing.roundCount === 1 &&
        cur != null &&
        cur.proposedByCompanyId === carrierCompanyId &&
        cur.amount.equals(toDecimal(input.amount)) &&
        (cur.message ?? "") === (input.message ?? "");
      if (idempotentReplay) {
        return { thread: await this.threadViewById(existing.id, "CARRIER"), created: false };
      }
      throw conflict(
        "You already have an active offer on this load — counter within it or withdraw it first",
      );
    }

    const now = new Date();
    const expiresAt = computeExpiry(now, input.expiresInHours);

    let threadId: string;
    try {
      threadId = await this.prisma.$transaction(async (tx) => {
        await this.lockLoad(tx, loadId);
        const fresh = await tx.load.findUniqueOrThrow({
          where: { id: loadId },
          select: { status: true },
        });
        if (!MARKETPLACE_VISIBLE_STATUSES.includes(fresh.status)) {
          throw conflict("This load is no longer on the marketplace");
        }

        const thread = await tx.offerThread.create({
          data: { loadId, carrierCompanyId, status: "ACTIVE", roundCount: 1 },
        });
        const round = await tx.offerRound.create({
          data: {
            threadId: thread.id,
            roundNumber: 1,
            proposedByCompanyId: carrierCompanyId,
            proposedByUserId: actor.userId,
            amount: toDecimal(input.amount),
            currency: input.currency,
            message: input.message ?? null,
            expiresAt,
          },
        });
        await tx.offerThread.update({
          where: { id: thread.id },
          data: { currentRoundId: round.id },
        });
        await this.appendOfferEvent(tx, {
          threadId: thread.id,
          roundId: round.id,
          type: "CREATED",
          actorUserId: actor.userId,
          actorCompanyId: carrierCompanyId,
          data: { amount: round.amount.toFixed(2), currency: round.currency },
        });
        await markLoadOfferReceived(tx, loadId, actor.userId);
        return thread.id;
      });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        // Lost a race to create the first thread — treat as "already have one".
        throw conflict("You already have an offer on this load");
      }
      throw err;
    }

    return { thread: await this.threadViewById(threadId, "CARRIER"), created: true };
  }

  // ── counter ─────────────────────────────────────────────────────────

  async counter(
    actor: AuthenticatedActor,
    roundId: string,
    input: CounterOfferInput,
  ): Promise<OfferThreadView> {
    const round = await this.prisma.offerRound.findUnique({
      where: { id: roundId },
      include: {
        thread: {
          select: {
            id: true,
            carrierCompanyId: true,
            load: { select: { shipperCompanyId: true } },
          },
        },
      },
    });
    if (!round) throw notFound("Offer not found");
    const { thread } = round;
    const viewer = this.viewerParty(actor, thread.carrierCompanyId, thread.load.shipperCompanyId);
    if (viewer === null || viewer === "ADMIN") throw notFound("Offer not found");

    this.assertRespondPermission(actor, viewer);
    assertCanRespond(
      this.roundCtx(thread.carrierCompanyId, thread.load.shipperCompanyId, round.proposedByCompanyId),
      actor.companyId!,
    );

    const now = new Date();
    const expiresAt = computeExpiry(now, input.expiresInHours);

    await this.prisma.$transaction(async (tx) => {
      await this.lockThread(tx, thread.id);
      const t = await tx.offerThread.findUniqueOrThrow({
        where: { id: thread.id },
        include: {
          currentRound: { select: { id: true, amount: true, expiresAt: true } },
          load: { select: { status: true } },
        },
      });

      if (await this.expireIfStale(tx, t, t.currentRound, now)) {
        throw conflict("This offer has expired");
      }
      if (!isThreadActive(t.status)) throw conflict("This negotiation is closed");
      if (t.currentRoundId !== roundId) {
        throw conflict("The negotiation has moved on — reload the current offer");
      }
      if (!isLoadOnMarket(t.load.status as LoadStatus)) {
        throw conflict("This load is no longer on the marketplace");
      }

      const newRound = await tx.offerRound.create({
        data: {
          threadId: t.id,
          roundNumber: t.roundCount + 1,
          proposedByCompanyId: actor.companyId!,
          proposedByUserId: actor.userId,
          amount: toDecimal(input.amount),
          currency: input.currency,
          message: input.message ?? null,
          expiresAt,
          parentRoundId: roundId,
        },
      });
      await tx.offerThread.update({
        where: { id: t.id },
        data: { currentRoundId: newRound.id, roundCount: { increment: 1 } },
      });
      await this.appendOfferEvent(tx, {
        threadId: t.id,
        roundId: newRound.id,
        type: "COUNTERED",
        actorUserId: actor.userId,
        actorCompanyId: actor.companyId,
        data: {
          fromAmount: round.amount.toFixed(2),
          toAmount: newRound.amount.toFixed(2),
          byParty: viewer,
        },
      });
    });

    return this.threadViewById(thread.id, viewer);
  }

  // ── accept → ATOMIC LOAD AWARD ──────────────────────────────────────

  async accept(actor: AuthenticatedActor, roundId: string): Promise<OfferThreadView> {
    const round = await this.prisma.offerRound.findUnique({
      where: { id: roundId },
      include: {
        thread: {
          select: {
            id: true,
            status: true,
            currentRoundId: true,
            carrierCompanyId: true,
            loadId: true,
            load: { select: { shipperCompanyId: true } },
          },
        },
      },
    });
    if (!round) throw notFound("Offer not found");
    const { thread } = round;
    const viewer = this.viewerParty(actor, thread.carrierCompanyId, thread.load.shipperCompanyId);
    if (viewer === null || viewer === "ADMIN") throw notFound("Offer not found");

    // Idempotent: this exact round already won.
    if (thread.status === "ACCEPTED" && thread.currentRoundId === roundId) {
      return this.threadViewById(thread.id, viewer);
    }

    this.assertRespondPermission(actor, viewer);
    assertCanRespond(
      this.roundCtx(thread.carrierCompanyId, thread.load.shipperCompanyId, round.proposedByCompanyId),
      actor.companyId!,
    );

    const loadId = thread.loadId;
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await this.lockLoad(tx, loadId);

      const t = await tx.offerThread.findUniqueOrThrow({
        where: { id: thread.id },
        include: {
          currentRound: { select: { id: true, amount: true, currency: true, expiresAt: true } },
          load: { select: { status: true } },
        },
      });

      if (await this.expireIfStale(tx, t, t.currentRound, now)) {
        throw new AppError(409, "OFFER_EXPIRED", "This offer has expired and cannot be accepted");
      }

      const loadRow = await tx.load.findUniqueOrThrow({
        where: { id: loadId },
        select: {
          status: true,
          equipmentType: true,
          origin: { select: { state: true } },
        },
      });
      const carrierCtx = await loadCarrierEligibilityContext(this.prisma, t.carrierCompanyId);
      const carrierEligibleNow = isCarrierEligibleForLoad(carrierCtx, {
        status: loadRow.status,
        equipmentType: loadRow.equipmentType,
        originState: loadRow.origin.state,
      }).eligible;

      // Pure preconditions, re-checked under the row lock.
      assertAwardable({
        load: { status: t.load.status as LoadStatus },
        thread: { status: t.status },
        currentRound: { id: t.currentRound!.id, expiresAt: t.currentRound!.expiresAt },
        acceptedRoundId: roundId,
        carrierEligibleNow,
        now,
      });

      const winningRound = t.currentRound!;

      // Atomic load award: compare-and-set POSTED|OFFER_RECEIVED → AWARDED. Under
      // concurrency exactly one transaction's updateMany matches; the other rolls
      // back (assertAwardable already rejected it above once this one committed).
      await atomicLoadTransition(tx, {
        id: loadId,
        from: t.load.status as LoadStatus,
        to: LoadStatus.AWARDED,
        actorUserId: actor.userId,
        extra: {
          carrierCompanyId: t.carrierCompanyId,
          bookedRate: winningRound.amount,
          currency: winningRound.currency,
          awardedOfferRoundId: winningRound.id,
          awardedAt: now,
        },
        note: "load awarded via marketplace offer",
        data: {
          threadId: t.id,
          offerRoundId: winningRound.id,
          amount: winningRound.amount.toFixed(2),
        },
      });

      // Winning thread → ACCEPTED (DB partial unique guarantees ≤ 1 per load).
      await tx.offerThread.update({
        where: { id: t.id },
        data: { status: "ACCEPTED", closedReason: "offer accepted", closedAt: now },
      });
      await this.appendOfferEvent(tx, {
        threadId: t.id,
        roundId: winningRound.id,
        type: "ACCEPTED",
        actorUserId: actor.userId,
        actorCompanyId: actor.companyId,
        data: { amount: winningRound.amount.toFixed(2), acceptedByParty: viewer },
      });

      // Every other ACTIVE thread on the load loses.
      const losers = await tx.offerThread.findMany({
        where: { loadId, status: "ACTIVE", id: { not: t.id } },
        select: { id: true, currentRoundId: true },
      });
      if (losers.length > 0) {
        await tx.offerThread.updateMany({
          where: { loadId, status: "ACTIVE", id: { not: t.id } },
          data: { status: "REJECTED", closedReason: "load_awarded_to_other", closedAt: now },
        });
        for (const loser of losers) {
          await this.appendOfferEvent(tx, {
            threadId: loser.id,
            roundId: loser.currentRoundId,
            type: "REJECTED",
            actorUserId: null,
            actorCompanyId: null,
            data: { reason: "load_awarded_to_other" },
          });
        }
      }
    });

    return this.threadViewById(thread.id, viewer);
  }

  // ── reject (shipper) / withdraw (carrier) ───────────────────────────

  async closeThread(
    actor: AuthenticatedActor,
    threadId: string,
    action: "reject" | "withdraw",
    input: CloseThreadInput,
  ): Promise<OfferThreadView> {
    const thread = await this.prisma.offerThread.findUnique({
      where: { id: threadId },
      select: {
        id: true,
        carrierCompanyId: true,
        load: { select: { shipperCompanyId: true } },
      },
    });
    if (!thread) throw notFound("Offer not found");
    const viewer = this.viewerParty(actor, thread.carrierCompanyId, thread.load.shipperCompanyId);
    if (viewer === null || viewer === "ADMIN") throw notFound("Offer not found");

    if (action === "reject") {
      if (viewer !== "SHIPPER") throw notFound("Offer not found");
      assertPermission(actor, Permission.OFFER_RESPOND);
    } else {
      if (viewer !== "CARRIER") throw notFound("Offer not found");
      assertPermission(actor, Permission.OFFER_MANAGE_OWN);
    }
    const target = action === "reject" ? "REJECTED" : "WITHDRAWN";

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.lockThread(tx, threadId);
      const t = await tx.offerThread.findUniqueOrThrow({
        where: { id: threadId },
        select: { status: true, currentRoundId: true },
      });
      if (t.status === target) return; // idempotent
      if (!isThreadActive(t.status)) throw conflict("This negotiation is already closed");
      assertThreadTransition("ACTIVE", target);

      await tx.offerThread.updateMany({
        where: { id: threadId, status: "ACTIVE" },
        data: {
          status: target,
          closedReason:
            input.reason?.slice(0, 500) ??
            (action === "reject" ? "rejected by shipper" : "withdrawn by carrier"),
          closedAt: now,
        },
      });
      await this.appendOfferEvent(tx, {
        threadId,
        roundId: t.currentRoundId,
        type: action === "reject" ? "REJECTED" : "WITHDRAWN",
        actorUserId: actor.userId,
        actorCompanyId: actor.companyId,
        data: input.reason ? { reason: input.reason.slice(0, 500) } : null,
      });
    });

    return this.threadViewById(threadId, viewer);
  }

  // ── reads ───────────────────────────────────────────────────────────

  async getThread(actor: AuthenticatedActor, threadId: string): Promise<OfferThreadView> {
    const t = await this.prisma.offerThread.findUnique({
      where: { id: threadId },
      select: { id: true, carrierCompanyId: true, load: { select: { shipperCompanyId: true } } },
    });
    if (!t) throw notFound("Offer not found");
    const viewer = this.viewerParty(actor, t.carrierCompanyId, t.load.shipperCompanyId);
    if (viewer === null) throw notFound("Offer not found");
    assertPermission(actor, Permission.OFFER_READ_OWN);

    await this.sweepThreads([threadId]);
    return this.threadViewById(threadId, viewer);
  }

  async getThreadByRound(actor: AuthenticatedActor, roundId: string): Promise<OfferThreadView> {
    const r = await this.prisma.offerRound.findUnique({
      where: { id: roundId },
      select: { threadId: true },
    });
    if (!r) throw notFound("Offer not found");
    return this.getThread(actor, r.threadId);
  }

  /** A carrier's own negotiations across every load. */
  async listCarrierThreads(
    actor: AuthenticatedActor,
    p: Pagination & { status?: string },
  ): Promise<Paginated<OfferThreadSummary>> {
    assertPermission(actor, Permission.OFFER_READ_OWN);
    const carrierCompanyId = actor.companyId;
    if (!carrierCompanyId) throw forbidden();

    const where: Prisma.OfferThreadWhereInput = {
      carrierCompanyId,
      ...(p.status ? { status: p.status as Prisma.OfferThreadWhereInput["status"] } : {}),
    };

    const activeIds = await this.prisma.offerThread.findMany({
      where: { carrierCompanyId, status: "ACTIVE" },
      select: { id: true },
    });
    await this.sweepThreads(activeIds.map((x) => x.id));

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.offerThread.findMany({
        where,
        include: threadSummaryInclude,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        ...toSkipTake(p),
      }),
      this.prisma.offerThread.count({ where }),
    ]);
    return paginate(
      rows.map((r) => toThreadSummary(r, "CARRIER")),
      total,
      p,
    );
  }

  /** The shipper's view of every negotiation on one of its own loads. */
  async listLoadThreads(actor: AuthenticatedActor, loadId: string): Promise<OfferThreadSummary[]> {
    const load = await this.prisma.load.findUnique({
      where: { id: loadId },
      select: { shipperCompanyId: true },
    });
    if (!load) throw notFound("Load not found");
    if (actor.role !== "ADMIN" && actor.companyId !== load.shipperCompanyId) {
      throw notFound("Load not found");
    }
    assertPermission(actor, Permission.OFFER_READ_OWN);

    const activeIds = await this.prisma.offerThread.findMany({
      where: { loadId, status: "ACTIVE" },
      select: { id: true },
    });
    await this.sweepThreads(activeIds.map((x) => x.id));

    const rows = await this.prisma.offerThread.findMany({
      where: { loadId },
      include: threadSummaryInclude,
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    });
    const viewer: ViewerParty = actor.role === "ADMIN" ? "ADMIN" : "SHIPPER";
    return rows.map((r) => toThreadSummary(r, viewer));
  }

  /** A carrier's negotiation on one specific load (marketplace board / detail). */
  async carrierThreadForLoad(
    actor: AuthenticatedActor,
    loadId: string,
  ): Promise<OfferThreadSummary | null> {
    const carrierCompanyId = actor.companyId;
    if (!carrierCompanyId) return null;

    const found = await this.prisma.offerThread.findUnique({
      where: { loadId_carrierCompanyId: { loadId, carrierCompanyId } },
      select: { id: true },
    });
    if (!found) return null;

    await this.sweepThreads([found.id]);
    const row = await this.prisma.offerThread.findUniqueOrThrow({
      where: { id: found.id },
      include: threadSummaryInclude,
    });
    return toThreadSummary(row, "CARRIER");
  }
}

// re-exported for tests / callers that need the turn rule.
export { respondingParty };
