import type { PrismaClient } from "@loadtopia/db";
import {
  deriveShipmentPodState,
  hasPermission,
  Permission,
  respondingParty,
  SHIPMENT_LOAD_STATUSES,
} from "@loadtopia/domain";
import type { ProviderRegistry } from "@loadtopia/providers";
import {
  type AuthenticatedActor,
  type CarrierAttentionItem,
  type CarrierDashboardSummary,
  type DashboardSummaryView,
  LoadStatus,
  marketplaceSearchSchema,
  type ShipperAttentionItem,
  type ShipperDashboardSummary,
} from "@loadtopia/shared";
import { AppError, forbidden } from "../../lib/errors";
import { loadFacilityScopeWhere } from "../../lib/facility-scope";
import { LoadsService } from "../loads/loads.service";
import { MarketplaceService } from "../marketplace/marketplace.service";
import { OffersService } from "../offers/offers.service";

/** Statuses on the way to (but not yet) delivered — "currently moving". */
const IN_PROGRESS_SHIPMENT_STATUSES: readonly LoadStatus[] = [
  LoadStatus.AWARDED,
  LoadStatus.CARRIER_ASSIGNED,
  LoadStatus.PICKED_UP,
  LoadStatus.IN_TRANSIT,
  LoadStatus.DELIVERED,
];

const RECENT_LIST_PAGE_SIZE = 5;

/**
 * Dashboard summary — plain facts composed from EXISTING, already-tested
 * read paths (Milestone 4 Phase 8). No new domain logic: POD-state grouping
 * reuses `deriveShipmentPodState` verbatim (so "Ready to Complete" agrees
 * with `LoadsService#complete`'s own authoritative rule by construction,
 * not by re-derivation), and offer-turn grouping reuses `respondingParty`
 * verbatim. "Recent" lists delegate entirely to the existing, already
 * facility-scoped (shipper) / company-scoped (carrier) list services —
 * this module never queries `Load` rows for a *list* itself, only for
 * bounded COUNT/groupBy-shaped aggregates.
 */
export class DashboardService {
  private readonly loads: LoadsService;
  private readonly marketplace: MarketplaceService;
  private readonly offers: OffersService;

  constructor(
    private readonly prisma: PrismaClient,
    providers: ProviderRegistry,
    log: { warn: (obj: unknown, msg: string) => void },
  ) {
    this.loads = new LoadsService(prisma, providers, log);
    this.marketplace = new MarketplaceService(prisma);
    this.offers = new OffersService(prisma);
  }

  async getSummary(actor: AuthenticatedActor): Promise<DashboardSummaryView> {
    if (hasPermission(actor, Permission.LOAD_READ_OWN)) {
      return this.getShipperSummary(actor);
    }
    return this.getCarrierSummary(actor);
  }

  // ── shipper ─────────────────────────────────────────────────────────

  private async getShipperSummary(actor: AuthenticatedActor): Promise<ShipperDashboardSummary> {
    const companyId = actor.companyId;
    if (!companyId) throw forbidden();

    // Facility scope (Milestone 4 Phase 7) — resolved ONCE, reused for every
    // count below via the exact same helper the Loads/Shipments lists use.
    // This is the entire facility-scope surface of the dashboard: no query
    // below omits it, and none re-derives the rule independently.
    const facilityScope = await loadFacilityScopeWhere(this.prisma, actor);
    const scoped = (extra: Record<string, unknown> = {}) => ({
      shipperCompanyId: companyId,
      ...extra,
      ...(facilityScope ? { AND: [facilityScope] } : {}),
    });

    const [
      totalLoadCount,
      draftLoadCount,
      activeShipmentCount,
      needsCoverageCount,
      deliveredLoads,
      recent,
    ] = await Promise.all([
      this.prisma.load.count({ where: scoped() }),
      this.prisma.load.count({ where: scoped({ status: LoadStatus.DRAFT }) }),
      this.prisma.load.count({
        where: scoped({ status: { in: [...IN_PROGRESS_SHIPMENT_STATUSES] } }),
      }),
      this.prisma.load.count({
        where: scoped({ status: { in: [LoadStatus.POSTED, LoadStatus.OFFER_RECEIVED] } }),
      }),
      // Bounded by "how many DELIVERED loads does this company have" — one
      // query, not one per load. Only the fields deriveShipmentPodState
      // actually reads are selected; the function does its own filtering
      // (docType/confirmedAt/removedAt), so pre-filtering here to
      // docType=POD, removedAt=null is a pure, safe narrowing — never a
      // second copy of its precedence logic.
      this.prisma.load.findMany({
        where: scoped({ status: LoadStatus.DELIVERED }),
        select: {
          documents: {
            where: { docType: "POD", removedAt: null },
            select: { docType: true, reviewStatus: true, confirmedAt: true, removedAt: true, createdAt: true },
          },
        },
      }),
      this.loads.listShipments(actor, companyId, { page: 1, pageSize: RECENT_LIST_PAGE_SIZE }),
    ]);

    let podAwaitingReviewCount = 0;
    let readyToCompleteCount = 0;
    let replacementPodNeededCount = 0;
    for (const load of deliveredLoads) {
      const podState = deriveShipmentPodState(load.documents);
      if (podState === "PENDING_REVIEW") podAwaitingReviewCount++;
      else if (podState === "APPROVED") readyToCompleteCount++;
      else if (podState === "REJECTED") replacementPodNeededCount++;
    }

    const attention: ShipperAttentionItem[] = [
      { kind: "NEEDS_COVERAGE", count: needsCoverageCount },
      { kind: "POD_AWAITING_REVIEW", count: podAwaitingReviewCount },
      { kind: "READY_TO_COMPLETE", count: readyToCompleteCount },
      { kind: "REPLACEMENT_POD_NEEDED", count: replacementPodNeededCount },
    ];

    return {
      role: "SHIPPER",
      overview: { activeShipmentCount, draftLoadCount, totalLoadCount },
      attention,
      recentShipments: recent.data,
    };
  }

  // ── carrier ─────────────────────────────────────────────────────────

  private async getCarrierSummary(actor: AuthenticatedActor): Promise<CarrierDashboardSummary> {
    const carrierCompanyId = actor.companyId;
    if (!carrierCompanyId) throw forbidden();

    // Carrier freight is never facility-scoped (Phase 7 §15 — a carrier's
    // own facility scope, if any, references its own company's locations
    // and has no relationship to a shipper load's origin/destination).
    // Every query below is scoped by carrierCompanyId only, exactly like
    // MarketplaceService#listMyShipments.
    const [
      wonShipmentCount,
      awaitingPickupCount,
      readyForTransitUpdateCount,
      awaitingDeliveryConfirmationCount,
      deliveredLoads,
      activeThreads,
      recentShipments,
      recentOffers,
      availableFreight,
    ] = await Promise.all([
      this.prisma.load.count({
        where: { carrierCompanyId, status: { in: [...SHIPMENT_LOAD_STATUSES] } },
      }),
      this.prisma.load.count({
        where: { carrierCompanyId, status: LoadStatus.CARRIER_ASSIGNED },
      }),
      this.prisma.load.count({
        where: { carrierCompanyId, status: LoadStatus.PICKED_UP },
      }),
      this.prisma.load.count({
        where: { carrierCompanyId, status: LoadStatus.IN_TRANSIT },
      }),
      this.prisma.load.findMany({
        where: { carrierCompanyId, status: LoadStatus.DELIVERED },
        select: {
          documents: {
            where: { docType: "POD", removedAt: null },
            select: { docType: true, reviewStatus: true, confirmedAt: true, removedAt: true, createdAt: true },
          },
        },
      }),
      // Bounded by "how many ACTIVE negotiations does this carrier have" —
      // one query, then respondingParty (the existing domain predicate,
      // never re-derived) decides whose turn each one is.
      this.prisma.offerThread.findMany({
        where: { carrierCompanyId, status: "ACTIVE" },
        select: {
          carrierCompanyId: true,
          load: { select: { shipperCompanyId: true } },
          currentRound: { select: { proposedByCompanyId: true } },
        },
      }),
      this.marketplace.listMyShipments(actor, { page: 1, pageSize: RECENT_LIST_PAGE_SIZE }),
      this.offers.listCarrierThreads(actor, { page: 1, pageSize: RECENT_LIST_PAGE_SIZE }),
      this.availableFreightCount(actor),
    ]);

    let podNeededCount = 0;
    let replacementPodNeededCount = 0;
    for (const load of deliveredLoads) {
      const podState = deriveShipmentPodState(load.documents);
      if (podState === "NONE") podNeededCount++;
      else if (podState === "REJECTED") replacementPodNeededCount++;
    }

    const awaitingMyResponseCount = activeThreads.filter(
      (t) =>
        t.currentRound !== null &&
        respondingParty({
          proposedByCompanyId: t.currentRound.proposedByCompanyId,
          loadShipperCompanyId: t.load.shipperCompanyId,
          threadCarrierCompanyId: t.carrierCompanyId,
        }) === "CARRIER",
    ).length;

    const attention: CarrierAttentionItem[] = [
      { kind: "AWAITING_MY_RESPONSE", count: awaitingMyResponseCount },
      { kind: "AWAITING_PICKUP", count: awaitingPickupCount },
      { kind: "READY_FOR_TRANSIT_UPDATE", count: readyForTransitUpdateCount },
      { kind: "AWAITING_DELIVERY_CONFIRMATION", count: awaitingDeliveryConfirmationCount },
      { kind: "POD_NEEDED", count: podNeededCount },
      { kind: "REPLACEMENT_POD_NEEDED", count: replacementPodNeededCount },
    ];

    return {
      role: "CARRIER",
      marketplaceEligible: availableFreight !== null,
      overview: {
        availableFreightCount: availableFreight,
        activeOfferCount: activeThreads.length,
        wonShipmentCount,
      },
      attention,
      recentShipments: recentShipments.data,
      recentOffers: recentOffers.data,
    };
  }

  /** `null` — never `0` — when the carrier is not currently marketplace
   *  eligible: eligibility and "zero available freight" are different facts
   *  and must never be conflated (Phase 8 §19). Reuses the real board query
   *  (`MarketplaceService#listLoads`, the same audience/eligibility/block
   *  filtering the actual board applies) rather than approximating it. */
  private async availableFreightCount(actor: AuthenticatedActor): Promise<number | null> {
    try {
      const q = marketplaceSearchSchema.parse({ pageSize: 1 });
      const result = await this.marketplace.listLoads(actor, q);
      return result.total;
    } catch (err) {
      if (err instanceof AppError && err.code === "CARRIER_NOT_ELIGIBLE") return null;
      throw err;
    }
  }
}
