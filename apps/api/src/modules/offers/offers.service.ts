import type { Prisma, PrismaClient } from "@loadtopia/db";
import {
  assertAwardable,
  AWARDABLE_LOAD_STATUSES,
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
  type BookAtPostedRateInput,
  type CloseThreadInput,
  type CounterOfferInput,
  type CreateOfferInput,
  LoadCommercialMode,
  LoadStatus,
  type OfferThreadSummary,
  type OfferThreadView,
  type Paginated,
  type Pagination,
} from "@loadtopia/shared";
import { AppError, conflict, forbidden, notFound } from "../../lib/errors";
import { loadCarrierEligibilityContext } from "../../lib/carrier-context";
import { atomicLoadTransition, markLoadOfferReceived } from "../../lib/load-lifecycle";
import { isLoadVisibleToCarrier } from "../loads/audience-access";
import { cancelPendingReleases } from "../loads/release-engine";
import { insertRateConfirmationSnapshot } from "../rate-confirmations/rate-confirmation.snapshot";
import type { RateConfirmationGenerator } from "../rate-confirmations/rate-confirmation.service";
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
 * Concurrency: {@link accept} and {@link bookAtPostedRate} both converge on
 * ONE shared internal transaction core, {@link executeCommercialAcceptance}
 * (Milestone 4 Phase 5) — a `SELECT … FOR UPDATE` row lock on the load, a
 * re-check of every precondition inside the transaction, and a compare-and-set
 * load transition through AWARDED and (same transaction) CARRIER_ASSIGNED.
 * There is exactly ONE authoritative way for a Load to become commercially
 * covered, regardless of whether the agreement came from negotiation or from
 * booking a posted rate — award validation, release cancellation, competitor
 * rejection, Rate Confirmation snapshotting, and automatic assignment are
 * never duplicated across the two call sites. Two carriers — negotiating,
 * booking, or one of each — can never both win.
 */
export class OffersService {
  /**
   * @param rateConfirmations Optional post-commit hook. When present,
   *   {@link accept} renders + stores the Rate Confirmation PDF after the award
   *   transaction commits (best-effort). The in-transaction commercial snapshot
   *   INSERT always happens regardless — it has no storage dependency.
   */
  constructor(
    private readonly prisma: PrismaClient,
    private readonly rateConfirmations?: RateConfirmationGenerator,
  ) {}

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
        shipperCompanyId: true,
        origin: { select: { state: true } },
      },
    });
    // IDOR-safe: a DRAFT / private / cancelled / awarded load is simply "not found"
    // to a carrier — they can only reach loads that are on the marketplace.
    if (!load || !MARKETPLACE_VISIBLE_STATUSES.includes(load.status)) {
      throw notFound("Load not found");
    }
    // Freight audience strategy (Milestone 4 Phase 4): never trust prior page
    // access — re-check CURRENT audience membership independently here, not
    // just at the marketplace list/detail GET (§23). A carrier outside the
    // current audience (or in-force-blocked) gets the same 404 as a load it
    // can't see at all — never a differently-worded 403 that would leak that
    // restricted freight exists.
    if (
      !(await isLoadVisibleToCarrier(this.prisma, carrierCompanyId, {
        id: loadId,
        shipperCompanyId: load.shipperCompanyId,
      }))
    ) {
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
        await markLoadOfferReceived(tx, loadId, actor.userId, actor.companyId);
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

    // Set when the current round is found expired: the lazy EXPIRED write + event
    // must COMMIT (throwing from inside $transaction would roll them back), so we
    // return from the callback and raise the 409 afterwards.
    let expired = false;

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
        expired = true;
        return;
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

    if (expired) throw conflict("This offer has expired");

    return this.threadViewById(thread.id, viewer);
  }

  // ── shared commercial-acceptance core ────────────────────────────────

  /**
   * THE single authoritative transaction body for "this Load has just become
   * commercially covered" (Milestone 4 Phase 5, §11-12) — called from inside
   * {@link accept}'s transaction for a negotiated acceptance, and from inside
   * {@link bookAtPostedRate}'s transaction for a posted-rate booking. Both
   * callers have ALREADY, under the same row lock: re-validated awardability,
   * re-validated carrier eligibility, and (for booking) re-validated audience
   * authorization + that the confirmed rate still matches. This function only
   * performs the award/assignment/agreement writes themselves — it never
   * re-derives eligibility, so it must never be called without those
   * preconditions freshly re-checked in the SAME transaction, under the SAME
   * lock, immediately beforehand.
   *
   * In order, inside `tx`:
   *   1. POSTED/OFFER_RECEIVED -> AWARDED (compare-and-set; sets
   *      carrierCompanyId/bookedRate/currency/awardedOfferRoundId/awardedAt
   *      in the SAME update, exactly as before Phase 5).
   *   2. AWARDED -> CARRIER_ASSIGNED, in the SAME transaction — a SEPARATE
   *      compare-and-set writing its own distinct immutable LoadEvent, so
   *      award and assignment remain two truthful facts even though a new
   *      Phase-5 Load never rests at AWARDED in between (§14). Legal per the
   *      existing load state machine (AWARDED -> CARRIER_ASSIGNED); safe
   *      unconditionally here because no other transaction can observe or
   *      mutate this row between steps 1 and 2 — this transaction still
   *      holds the row lock taken by the caller.
   *   3. Cancel any pending Phase 4 audience releases (§18) — inherited
   *      identically by both callers precisely BECAUSE this is one shared
   *      function, not two copies that could drift.
   *   4. Winning thread -> ACCEPTED + immutable offer event.
   *   5. Every other ACTIVE thread on the load -> REJECTED
   *      ("load_awarded_to_other") + immutable offer events — unchanged,
   *      already origin-agnostic (works identically for a booked winner).
   *   6. Insert the immutable Rate Confirmation commercial snapshot — works
   *      identically for a negotiated or a synthesized winning round; no
   *      RC schema change was needed for booking (§16).
   */
  private async executeCommercialAcceptance(
    tx: Tx,
    p: {
      loadId: string;
      fromStatus: LoadStatus;
      threadId: string;
      carrierCompanyId: string;
      winningRoundId: string;
      winningAmount: Prisma.Decimal;
      winningCurrency: string;
      actorUserId: string;
      actorCompanyId: string | null;
      now: Date;
      awardNote: string;
      awardData: Record<string, unknown>;
      acceptedByParty: ViewerParty;
    },
  ): Promise<void> {
    await atomicLoadTransition(tx, {
      id: p.loadId,
      from: p.fromStatus,
      to: LoadStatus.AWARDED,
      actorUserId: p.actorUserId,
      actorCompanyId: p.actorCompanyId,
      extra: {
        carrierCompanyId: p.carrierCompanyId,
        bookedRate: p.winningAmount,
        currency: p.winningCurrency,
        awardedOfferRoundId: p.winningRoundId,
        awardedAt: p.now,
      },
      note: p.awardNote,
      data: p.awardData,
    });

    // Automatic company-level assignment, same transaction, distinct event
    // (Milestone 4 Phase 5 §14) — the ordinary shipper "Assign Carrier" step
    // no longer applies to any load awarded from here forward; see
    // loads.service.ts#assign's doc comment for the narrow legacy path that
    // endpoint remains for.
    await atomicLoadTransition(tx, {
      id: p.loadId,
      from: LoadStatus.AWARDED,
      to: LoadStatus.CARRIER_ASSIGNED,
      actorUserId: p.actorUserId,
      actorCompanyId: p.actorCompanyId,
      extra: { assignedAt: p.now },
      note: "carrier automatically assigned at commercial acceptance",
      data: { carrierCompanyId: p.carrierCompanyId },
    });

    // A covered (awarded) load must never widen its audience afterward —
    // cancel any pending scheduled release in this SAME transaction (§18).
    await cancelPendingReleases(tx, p.loadId, "load_covered", p.actorUserId, p.actorCompanyId);

    // Winning thread → ACCEPTED (DB partial unique guarantees ≤ 1 per load).
    await tx.offerThread.update({
      where: { id: p.threadId },
      data: { status: "ACCEPTED", closedReason: "offer accepted", closedAt: p.now },
    });
    await this.appendOfferEvent(tx, {
      threadId: p.threadId,
      roundId: p.winningRoundId,
      type: "ACCEPTED",
      actorUserId: p.actorUserId,
      actorCompanyId: p.actorCompanyId,
      data: { amount: p.winningAmount.toFixed(2), acceptedByParty: p.acceptedByParty },
    });

    // Every other ACTIVE thread on the load loses.
    const losers = await tx.offerThread.findMany({
      where: { loadId: p.loadId, status: "ACTIVE", id: { not: p.threadId } },
      select: { id: true, currentRoundId: true },
    });
    if (losers.length > 0) {
      await tx.offerThread.updateMany({
        where: { loadId: p.loadId, status: "ACTIVE", id: { not: p.threadId } },
        data: { status: "REJECTED", closedReason: "load_awarded_to_other", closedAt: p.now },
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

    // Phase 1 of the Rate Confirmation: the immutable commercial snapshot,
    // INSIDE this same transaction. Coupled to the award on purpose — if it
    // cannot be written, the whole transaction rolls back, so "exactly one
    // snapshot per awarded load" is transactional. `now` is the SAME
    // timestamp already used for Load.awardedAt / OfferThread.closedAt
    // above. No storage here.
    await insertRateConfirmationSnapshot(tx, {
      loadId: p.loadId,
      carrierCompanyId: p.carrierCompanyId,
      awardedOfferRoundId: p.winningRoundId,
      agreedRate: p.winningAmount,
      currency: p.winningCurrency,
      awardedAt: p.now,
    });
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

    // Set when the current round is found expired: the lazy EXPIRED write + event
    // must COMMIT (throwing from inside $transaction would roll them back), so we
    // return from the callback and raise the 409 afterwards.
    let expired = false;

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
        expired = true;
        return;
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

      // Converge on the ONE shared commercial-acceptance core (§11) — award,
      // automatic assignment, release cancellation, competitor rejection, and
      // RC snapshotting are never duplicated between negotiated acceptance
      // and Book at Posted Rate.
      await this.executeCommercialAcceptance(tx, {
        loadId,
        fromStatus: t.load.status as LoadStatus,
        threadId: t.id,
        carrierCompanyId: t.carrierCompanyId,
        winningRoundId: winningRound.id,
        winningAmount: winningRound.amount,
        winningCurrency: winningRound.currency,
        actorUserId: actor.userId,
        actorCompanyId: actor.companyId,
        now,
        awardNote: "load awarded via marketplace offer",
        awardData: {
          threadId: t.id,
          offerRoundId: winningRound.id,
          amount: winningRound.amount.toFixed(2),
        },
        acceptedByParty: viewer,
      });
    });

    if (expired) {
      throw new AppError(409, "OFFER_EXPIRED", "This offer has expired and cannot be accepted");
    }

    // Phase 2 of the Rate Confirmation: render + store the PDF AFTER COMMIT.
    // Best-effort and fully isolated — the generator never throws, and even if
    // it did this catch would swallow it. A storage/render failure here leaves
    // the committed award and its immutable snapshot untouched; retrieval
    // retries later.
    if (this.rateConfirmations) {
      try {
        await this.rateConfirmations.generateAfterAward(loadId);
      } catch {
        /* committed award is unaffected */
      }
    }

    return this.threadViewById(thread.id, viewer);
  }

  // ── carrier: Book at Posted Rate → ATOMIC LOAD AWARD ────────────────

  /**
   * Binding commercial acceptance of a shipper's published rate (Milestone 4
   * Phase 5, §9-10). Synthesizes the truthful winning `OfferThread` +
   * `OfferRound` this agreement represents — round 1 is proposed BY THE
   * SHIPPER (the load's own creator, on the load's own posted terms), never
   * by the booking carrier, so this is never "a carrier proposes, then
   * accepts its own proposal": it is a carrier accepting an offer the
   * shipper already made by publishing the rate. That thread then converges
   * on the exact same {@link executeCommercialAcceptance} core `accept()`
   * uses — no separate booking/award engine exists.
   *
   * "What the user saw is not authority — the transaction is": every
   * precondition (load still awardable, still PUBLISH_RATE, the posted rate
   * still equal to `input.confirmedRate`, the carrier still audience-
   * authorized and eligible) is re-read and re-checked fresh, under the
   * load's row lock, never trusted from the pre-transaction read that served
   * the confirmation dialog.
   */
  async bookAtPostedRate(
    actor: AuthenticatedActor,
    loadId: string,
    input: BookAtPostedRateInput,
  ): Promise<OfferThreadView> {
    assertPermission(actor, Permission.OFFER_CREATE);
    const carrierCompanyId = actor.companyId;
    if (!carrierCompanyId) throw forbidden();

    // Idempotency FIRST, before any load-status-dependent check: a load this
    // carrier already won is, correctly, no longer marketplace-visible and no
    // longer "eligible" (isCarrierEligibleForLoad excludes AWARDED/
    // CARRIER_ASSIGNED) — a retried double-click must resolve to the SAME
    // accepted outcome, not a misleading "not found"/"not eligible" error.
    const existingThread = await this.prisma.offerThread.findUnique({
      where: { loadId_carrierCompanyId: { loadId, carrierCompanyId } },
    });
    if (existingThread) {
      if (existingThread.status === "ACCEPTED") {
        return this.threadViewById(existingThread.id, "CARRIER");
      }
      throw conflict(
        "You already have a negotiation on this load — accept, counter, or withdraw it first",
      );
    }

    const load = await this.prisma.load.findUnique({
      where: { id: loadId },
      select: {
        status: true,
        equipmentType: true,
        shipperCompanyId: true,
        createdByUserId: true,
        commercialMode: true,
        postedRate: true,
        origin: { select: { state: true } },
      },
    });
    // IDOR-safe: same rule as createOffer — a DRAFT / private / cancelled /
    // awarded load is simply "not found" to a carrier.
    if (!load || !MARKETPLACE_VISIBLE_STATUSES.includes(load.status)) {
      throw notFound("Load not found");
    }
    // Freight audience strategy (Milestone 4 Phase 4): never trust prior page
    // access — re-check CURRENT audience membership independently (§24).
    if (
      !(await isLoadVisibleToCarrier(this.prisma, carrierCompanyId, {
        id: loadId,
        shipperCompanyId: load.shipperCompanyId,
      }))
    ) {
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
      throw new AppError(403, "NOT_ELIGIBLE_FOR_LOAD", "You are not eligible to book this load", {
        reasons: elig.reasons,
      });
    }

    if (load.commercialMode !== LoadCommercialMode.PUBLISH_RATE || load.postedRate == null) {
      throw new AppError(
        409,
        "COMMERCIAL_TERMS_CHANGED",
        "This load is no longer offering a posted rate to book. Refresh to see its current terms.",
      );
    }
    if (!load.postedRate.equals(toDecimal(input.confirmedRate))) {
      throw new AppError(
        409,
        "COMMERCIAL_TERMS_CHANGED",
        "The posted rate has changed since you last viewed this load. Refresh and try again.",
      );
    }

    const now = new Date();
    let threadId: string;
    try {
      threadId = await this.prisma.$transaction(async (tx) => {
        await this.lockLoad(tx, loadId);

        // Re-read EVERYTHING authoritative, under the lock. The pre-transaction
        // reads above only decided whether it was worth opening a transaction
        // at all — none of them are trusted here.
        const fresh = await tx.load.findUniqueOrThrow({
          where: { id: loadId },
          select: {
            status: true,
            equipmentType: true,
            commercialMode: true,
            postedRate: true,
            origin: { select: { state: true } },
          },
        });
        if (!AWARDABLE_LOAD_STATUSES.includes(fresh.status as LoadStatus)) {
          throw conflict("This load is no longer on the marketplace");
        }
        if (fresh.commercialMode !== LoadCommercialMode.PUBLISH_RATE || fresh.postedRate == null) {
          throw new AppError(
            409,
            "COMMERCIAL_TERMS_CHANGED",
            "This load is no longer offering a posted rate to book.",
          );
        }
        if (!fresh.postedRate.equals(toDecimal(input.confirmedRate))) {
          throw new AppError(
            409,
            "COMMERCIAL_TERMS_CHANGED",
            "The posted rate has changed since you last viewed this load. Refresh and try again.",
          );
        }
        if (
          !(await isLoadVisibleToCarrier(tx, carrierCompanyId, {
            id: loadId,
            shipperCompanyId: load.shipperCompanyId,
          }))
        ) {
          throw notFound("Load not found");
        }
        const carrierCtxNow = await loadCarrierEligibilityContext(this.prisma, carrierCompanyId);
        const eligNow = isCarrierEligibleForLoad(carrierCtxNow, {
          status: fresh.status,
          equipmentType: fresh.equipmentType,
          originState: fresh.origin.state,
        });
        if (!eligNow.eligible) {
          throw new AppError(403, "CARRIER_NOT_ELIGIBLE", "You are no longer eligible for this load", {
            reasons: eligNow.reasons,
          });
        }

        // The truthful winning thread: round 1 proposed BY THE SHIPPER, at
        // the shipper's own published rate — never fabricated negotiation.
        const thread = await tx.offerThread.create({
          data: {
            loadId,
            carrierCompanyId,
            status: "ACTIVE",
            roundCount: 1,
            originType: "POSTED_RATE_BOOKING",
          },
        });
        const round = await tx.offerRound.create({
          data: {
            threadId: thread.id,
            roundNumber: 1,
            proposedByCompanyId: load.shipperCompanyId,
            proposedByUserId: load.createdByUserId,
            amount: fresh.postedRate,
            currency: "USD",
            message: null,
            // Immediately accepted below — never negotiated — so this deadline
            // is inert. Set safely in the future purely so the round never
            // displays as "expired" once won.
            expiresAt: computeExpiry(now, 24),
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
          actorUserId: null,
          actorCompanyId: load.shipperCompanyId,
          data: { amount: round.amount.toFixed(2), currency: round.currency, origin: "POSTED_RATE_BOOKING" },
        });

        // Converge on the ONE shared commercial-acceptance core (§11) — the
        // exact same award/assignment/release-cancellation/RC path accept()
        // uses. This is what makes booking's history truthful: "carrier
        // accepted the shipper's posted rate," not a separate booking engine.
        await this.executeCommercialAcceptance(tx, {
          loadId,
          fromStatus: fresh.status as LoadStatus,
          threadId: thread.id,
          carrierCompanyId,
          winningRoundId: round.id,
          winningAmount: round.amount,
          winningCurrency: round.currency,
          actorUserId: actor.userId,
          actorCompanyId: actor.companyId,
          now,
          awardNote: "load awarded via booking at posted rate",
          awardData: {
            threadId: thread.id,
            offerRoundId: round.id,
            amount: round.amount.toFixed(2),
            origin: "POSTED_RATE_BOOKING",
          },
          acceptedByParty: "CARRIER",
        });

        return thread.id;
      });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        // Lost a race to create the first thread on this load for this
        // carrier — the same DB backstop createOffer relies on.
        throw conflict("You already have an offer on this load");
      }
      throw err;
    }

    // Phase 2 of the Rate Confirmation: render + store the PDF AFTER COMMIT —
    // identical best-effort post-commit path to accept().
    if (this.rateConfirmations) {
      try {
        await this.rateConfirmations.generateAfterAward(loadId);
      } catch {
        /* committed award is unaffected */
      }
    }

    return this.threadViewById(threadId, "CARRIER");
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
