import type { Prisma, PrismaClient } from "@loadtopia/db";
import {
  assertPermission,
  carrierMarketplaceAccess,
  isCarrierEligibleForLoad,
  MARKETPLACE_VISIBLE_STATUSES,
  Permission,
} from "@loadtopia/domain";
import {
  type AuthenticatedActor,
  type CreateOfferInput,
  type MarketplaceLoadListItem,
  type MarketplaceLoadView,
  type MarketplaceSearchQuery,
  type OfferThreadView,
  type Paginated,
} from "@loadtopia/shared";
import { AppError, forbidden, notFound } from "../../lib/errors";
import { loadCarrierEligibilityContext } from "../../lib/carrier-context";
import { paginate, toSkipTake } from "../../lib/pagination";
import { OffersService } from "../offers/offers.service";
import { threadSummaryInclude, toThreadSummary } from "../offers/offer.serializer";
import {
  marketplaceLoadInclude,
  METERS_PER_MILE,
  toMarketplaceListItem,
} from "./marketplace.serializer";

type CarrierCtx = Awaited<ReturnType<typeof loadCarrierEligibilityContext>>;

/**
 * Carrier-facing marketplace: the load board + a single load's detail, plus
 * offer creation (delegated to {@link OffersService}). Visibility is
 * server-authoritative — a carrier only ever sees loads that are
 * `POSTED`/`OFFER_RECEIVED` AND compatible with its own eligible profile. The
 * `WHERE` is isolated here so a future PostGIS / search backend can replace it.
 */
export class MarketplaceService {
  private readonly offers: OffersService;

  constructor(private readonly prisma: PrismaClient) {
    this.offers = new OffersService(prisma);
  }

  /** Board access: must be an eligible carrier. Returns its eligibility context. */
  private async requireBoardAccess(actor: AuthenticatedActor): Promise<CarrierCtx> {
    assertPermission(actor, Permission.MARKETPLACE_BROWSE);
    if (!actor.companyId) throw forbidden();
    const ctx = await loadCarrierEligibilityContext(this.prisma, actor.companyId);
    const access = carrierMarketplaceAccess(ctx, actor.role);
    if (!access.eligible) {
      throw new AppError(
        403,
        "CARRIER_NOT_ELIGIBLE",
        "Your company is not eligible to browse the marketplace",
        { reasons: access.reasons },
      );
    }
    return ctx;
  }

  private async myThreadsByLoad(
    carrierCompanyId: string,
    loadIds: string[],
  ): Promise<Map<string, ReturnType<typeof toThreadSummary>>> {
    if (loadIds.length === 0) return new Map();
    const rows = await this.prisma.offerThread.findMany({
      where: { carrierCompanyId, loadId: { in: loadIds } },
      include: threadSummaryInclude,
    });
    return new Map(rows.map((r) => [r.loadId, toThreadSummary(r, "CARRIER")]));
  }

  async listLoads(
    actor: AuthenticatedActor,
    q: MarketplaceSearchQuery,
  ): Promise<Paginated<MarketplaceLoadListItem>> {
    const ctx = await this.requireBoardAccess(actor);
    const profile = ctx.profile!; // guaranteed by requireBoardAccess

    // Hard server-side filters (a client can never widen these).
    const equipmentIn =
      profile.equipmentTypes.length > 0
        ? q.equipmentType
          ? profile.equipmentTypes.includes(q.equipmentType)
            ? [q.equipmentType]
            : []
          : profile.equipmentTypes
        : q.equipmentType
          ? [q.equipmentType]
          : undefined;
    // No equipment overlap between filter and profile → empty page, not an error.
    if (equipmentIn && equipmentIn.length === 0) {
      return paginate<MarketplaceLoadListItem>([], 0, q);
    }

    const originStates =
      profile.serviceAreaStates.length > 0
        ? q.originState
          ? profile.serviceAreaStates.includes(q.originState.toUpperCase())
            ? [q.originState.toUpperCase()]
            : []
          : profile.serviceAreaStates
        : q.originState
          ? [q.originState.toUpperCase()]
          : undefined;
    if (originStates && originStates.length === 0) {
      return paginate<MarketplaceLoadListItem>([], 0, q);
    }

    const pickupWindow: Prisma.DateTimeNullableFilter | undefined =
      q.pickupFrom || q.pickupTo
        ? {
            ...(q.pickupFrom ? { gte: new Date(q.pickupFrom) } : {}),
            ...(q.pickupTo ? { lte: new Date(q.pickupTo) } : {}),
          }
        : undefined;

    const distanceFilter: Prisma.IntNullableFilter | undefined =
      q.minMiles != null || q.maxMiles != null
        ? {
            ...(q.minMiles != null ? { gte: Math.floor(q.minMiles * METERS_PER_MILE) } : {}),
            ...(q.maxMiles != null ? { lte: Math.ceil(q.maxMiles * METERS_PER_MILE) } : {}),
          }
        : undefined;

    const where: Prisma.LoadWhereInput = {
      status: { in: [...MARKETPLACE_VISIBLE_STATUSES] },
      ...(equipmentIn ? { equipmentType: { in: equipmentIn } } : {}),
      ...(q.mode ? { mode: q.mode } : {}),
      ...(originStates ? { origin: { state: { in: originStates } } } : {}),
      ...(q.destinationState
        ? { destination: { state: q.destinationState.toUpperCase() } }
        : {}),
      ...(pickupWindow ? { pickupWindowStart: pickupWindow } : {}),
      ...(distanceFilter ? { distanceMeters: distanceFilter } : {}),
    };

    // Deterministic ordering — always a unique tiebreaker (id).
    const orderBy: Prisma.LoadOrderByWithRelationInput[] =
      q.sort === "pickup"
        ? [{ pickupWindowStart: "asc" }, { id: "asc" }]
        : q.sort === "miles"
          ? [{ distanceMeters: "asc" }, { id: "asc" }]
          : [{ postedAt: "desc" }, { id: "desc" }];

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.load.findMany({ where, include: marketplaceLoadInclude, orderBy, ...toSkipTake(q) }),
      this.prisma.load.count({ where }),
    ]);

    const threads = await this.myThreadsByLoad(
      actor.companyId!,
      rows.map((r) => r.id),
    );
    return paginate(
      rows.map((r) => toMarketplaceListItem(r, threads.get(r.id) ?? null)),
      total,
      q,
    );
  }

  async getLoad(actor: AuthenticatedActor, loadId: string): Promise<MarketplaceLoadView> {
    const ctx = await this.requireBoardAccess(actor);

    const load = await this.prisma.load.findUnique({
      where: { id: loadId },
      include: marketplaceLoadInclude,
    });
    // Not on the marketplace ⇒ 404 (IDOR-safe: no probing DRAFT/private/awarded).
    if (!load || !MARKETPLACE_VISIBLE_STATUSES.includes(load.status)) {
      throw notFound("Load not found");
    }

    const eligibility = isCarrierEligibleForLoad(ctx, {
      status: load.status,
      equipmentType: load.equipmentType,
      originState: load.origin.state,
    });

    const threads = await this.myThreadsByLoad(actor.companyId!, [loadId]);
    return {
      ...toMarketplaceListItem(load, threads.get(loadId) ?? null),
      eligibility: { eligible: eligibility.eligible, reasons: [...eligibility.reasons] },
    };
  }

  async createOffer(
    actor: AuthenticatedActor,
    loadId: string,
    input: CreateOfferInput,
  ): Promise<{ thread: OfferThreadView; created: boolean }> {
    return this.offers.createOffer(actor, loadId, input);
  }

  /** This carrier's negotiation on one load (for the board / load detail page). */
  async myThreadForLoad(actor: AuthenticatedActor, loadId: string) {
    assertPermission(actor, Permission.OFFER_READ_OWN);
    return this.offers.carrierThreadForLoad(actor, loadId);
  }
}
