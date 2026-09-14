import {
  computeRatePerMile,
  EXPOSED_LOAD_STATUSES,
  isLoadOnMarket,
  type LoadViewerRole,
  nextLoadStatuses,
  shipmentNextAction,
  type ShipmentViewerSide,
} from "@loadtopia/domain";
import {
  type LoadAudienceView,
  type LoadEventView,
  type LoadListItem,
  LoadReleaseStatus,
  LoadStatus,
  type LoadView,
  type ShipmentListItem,
} from "@loadtopia/shared";
import type { Prisma } from "@loadtopia/db";
import { MOCK_PROVIDER_NAME } from "@loadtopia/providers";
import { money, moneyOrNull } from "../../lib/money";
import { toLocationView } from "../locations/locations.service";

const METERS_PER_MILE = 1609.344;

export function metersToMiles(meters: number | null): number | null {
  if (meters == null) return null;
  return Math.round((meters / METERS_PER_MILE) * 10) / 10;
}

export const loadListInclude = {
  origin: { select: { city: true, state: true } },
  destination: { select: { city: true, state: true } },
  offerThreads: { where: { status: "ACTIVE" }, select: { id: true } },
  // Freight audience strategy (Milestone 4 Phase 4) — a lightweight summary
  // only: strategy/stage plus the single earliest pending release, all from
  // this SAME query via the relation, never a per-row follow-up query.
  audienceStrategy: {
    select: {
      strategy: true,
      currentStage: true,
      releases: {
        where: { status: "PENDING" },
        orderBy: { scheduledAt: "asc" },
        take: 1,
        select: { scheduledAt: true },
      },
    },
  },
} satisfies Prisma.LoadInclude;

export const loadDetailInclude = {
  origin: true,
  destination: true,
  carrierCompany: { select: { id: true, name: true } },
  awardedOfferRound: { select: { amount: true, currency: true } },
  offerThreads: { where: { status: "ACTIVE" }, select: { id: true } },
  // Existence of an active, approved POD — drives `completionReady` and gates
  // whether COMPLETED is advertised in `availableTransitions`. Indexed by
  // (load_id, doc_type, review_status); bounded to one row.
  documents: {
    where: {
      docType: "POD",
      confirmedAt: { not: null },
      reviewStatus: "APPROVED",
      removedAt: null,
    },
    select: { id: true },
    take: 1,
  },
  events: {
    orderBy: { createdAt: "asc" },
    include: { actor: { select: { firstName: true, lastName: true } } },
  },
  // Freight audience strategy (Milestone 4 Phase 4). Absent (null) for a
  // DRAFT load and for a pre-Phase-4 posted load — see LoadAudienceView.
  // `audienceMembers` fetches EVERY snapshot row the load has ever had
  // (a load may carry both a SELECTED-stage and a later NETWORK-stage
  // snapshot) — `toAudienceView` picks the count matching the CURRENT
  // stage; a small, bounded list, never worth a second round trip.
  audienceStrategy: { include: { releases: { orderBy: { scheduledAt: "asc" } } } },
  audienceMembers: { select: { stage: true } },
} satisfies Prisma.LoadInclude;

type LoadListRow = Prisma.LoadGetPayload<{ include: typeof loadListInclude }>;
type LoadDetailRow = Prisma.LoadGetPayload<{ include: typeof loadDetailInclude }>;

export function toLoadListItem(l: LoadListRow): LoadListItem {
  return {
    id: l.id,
    referenceNumber: l.referenceNumber,
    status: l.status,
    equipmentType: l.equipmentType,
    mode: l.mode,
    weightLbs: l.weightLbs,
    commodity: l.commodity,
    origin: { city: l.origin.city, state: l.origin.state },
    destination: { city: l.destination.city, state: l.destination.state },
    pickupWindowStart: l.pickupWindowStart?.toISOString() ?? null,
    pickupWindowEnd: l.pickupWindowEnd?.toISOString() ?? null,
    deliveryWindowStart: l.deliveryWindowStart?.toISOString() ?? null,
    deliveryWindowEnd: l.deliveryWindowEnd?.toISOString() ?? null,
    miles: metersToMiles(l.distanceMeters),
    audience: l.audienceStrategy
      ? {
          strategy: l.audienceStrategy.strategy,
          currentStage: l.audienceStrategy.currentStage,
          nextReleaseAt: l.audienceStrategy.releases[0]?.scheduledAt.toISOString() ?? null,
        }
      : null,
    activeOfferCount: l.offerThreads.length,
    createdAt: l.createdAt.toISOString(),
  };
}

function toEventView(e: LoadDetailRow["events"][number]): LoadEventView {
  return {
    id: e.id,
    type: e.type,
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    actorUserId: e.actorUserId,
    actorName: e.actor ? `${e.actor.firstName} ${e.actor.lastName}` : null,
    note: e.note,
    createdAt: e.createdAt.toISOString(),
  };
}

/**
 * The party that can drive a given load transition through an API endpoint.
 * A `(from, to)` pair not listed here has no direct load endpoint — it flows
 * from the offer/marketplace surface (e.g. `POSTED → AWARDED`). The reserved
 * `OFFER_RECEIVED/AWARDED → POSTED` edge is filtered out entirely by the caller
 * (Slice 8 closeout — `/post` is DRAFT-only), so it never reaches this map.
 */
function transitionActor(from: LoadStatus, to: LoadStatus): "shipper" | "carrier" | null {
  if (to === LoadStatus.CANCELLED) return "shipper"; // POST /loads/:id/cancel
  if (from === LoadStatus.DRAFT && to === LoadStatus.POSTED) return "shipper"; // /post
  if (from === LoadStatus.POSTED && to === LoadStatus.DRAFT) return "shipper"; // /unpost
  if (from === LoadStatus.AWARDED && to === LoadStatus.CARRIER_ASSIGNED) return "shipper"; // /assign
  if (from === LoadStatus.DELIVERED && to === LoadStatus.COMPLETED) return "shipper"; // /complete
  if (from === LoadStatus.CARRIER_ASSIGNED && to === LoadStatus.PICKED_UP) return "carrier"; // /pickup
  if (from === LoadStatus.PICKED_UP && to === LoadStatus.IN_TRANSIT) return "carrier"; // /in-transit
  if (from === LoadStatus.IN_TRANSIT && to === LoadStatus.DELIVERED) return "carrier"; // /deliver
  return null;
}

function toAudienceView(l: LoadDetailRow): LoadAudienceView | null {
  const strategy = l.audienceStrategy;
  if (!strategy) return null;
  return {
    strategy: strategy.strategy,
    currentStage: strategy.currentStage,
    autoReleaseDisabled: strategy.autoReleaseDisabled,
    // The frozen snapshot count AT THE CURRENT STAGE — a load may carry an
    // older SELECTED-stage snapshot from before a Network release; that
    // count is never shown once currentStage has moved past it. Null for
    // MARKETPLACE, which has no finite snapshot.
    audienceCount:
      strategy.currentStage === "MARKETPLACE"
        ? null
        : l.audienceMembers.filter((m) => m.stage === strategy.currentStage).length,
    pendingReleases: strategy.releases
      .filter((r) => r.status === LoadReleaseStatus.PENDING)
      .map((r) => ({
        id: r.id,
        toStage: r.toStage,
        status: r.status,
        scheduledAt: r.scheduledAt.toISOString(),
        executedAt: r.executedAt?.toISOString() ?? null,
        cancelledAt: r.cancelledAt?.toISOString() ?? null,
        cancelReason: r.cancelReason,
      })),
  };
}

export function toLoadView(l: LoadDetailRow, viewerRole: LoadViewerRole): LoadView {
  // Objective, actor-independent: this load is DELIVERED and has an active
  // approved POD, so completion WOULD succeed for an authorized shipper.
  const completionReady = l.status === LoadStatus.DELIVERED && l.documents.length > 0;

  // Actor-aware: only advertise transitions THIS viewer could actually trigger.
  // Endpoint enforcement is unchanged — this only removes misleading UI hints.
  const availableTransitions = nextLoadStatuses(l.status)
    .filter((s) => EXPOSED_LOAD_STATUSES.includes(s))
    .filter((s) => {
      // The reserved OFFER_RECEIVED/AWARDED → POSTED domain edge has no endpoint
      // and no product behind it (`/post` is DRAFT-only). Never advertise it —
      // to any reader (Slice 8 closeout). The domain map is unchanged.
      if (
        s === LoadStatus.POSTED &&
        (l.status === LoadStatus.OFFER_RECEIVED || l.status === LoadStatus.AWARDED)
      ) {
        return false;
      }
      const owner = transitionActor(l.status, s);
      if (owner !== null && viewerRole !== "admin" && owner !== viewerRole) return false;
      if (s === LoadStatus.COMPLETED) return completionReady;
      return true;
    });

  return {
    id: l.id,
    referenceNumber: l.referenceNumber,
    status: l.status,
    shipperCompanyId: l.shipperCompanyId,
    equipmentType: l.equipmentType,
    mode: l.mode,
    commodity: l.commodity,
    weightLbs: l.weightLbs,
    origin: toLocationView(l.origin),
    destination: toLocationView(l.destination),
    pickupWindowStart: l.pickupWindowStart?.toISOString() ?? null,
    pickupWindowEnd: l.pickupWindowEnd?.toISOString() ?? null,
    deliveryWindowStart: l.deliveryWindowStart?.toISOString() ?? null,
    deliveryWindowEnd: l.deliveryWindowEnd?.toISOString() ?? null,
    routing: {
      miles: metersToMiles(l.distanceMeters),
      driveTimeMinutes: l.driveTimeMinutes,
      provider: l.routingProvider,
      // Derived from the PROVIDER NAME STORED ON THIS LOAD at routing time —
      // never from whichever routing provider is currently configured. A load
      // routed by the mock before a production cutover to Google must keep
      // showing as mock forever; it must never be relabeled "real" just
      // because the registry's active adapter changed later.
      isMock: l.routingProvider === MOCK_PROVIDER_NAME,
      routedAt: l.routedAt?.toISOString() ?? null,
    },
    availableTransitions,
    completionReady,
    createdByUserId: l.createdByUserId,
    updatedByUserId: l.updatedByUserId,
    postedAt: l.postedAt?.toISOString() ?? null,
    cancelledAt: l.cancelledAt?.toISOString() ?? null,
    pickedUpAt: l.pickedUpAt?.toISOString() ?? null,
    deliveredAt: l.deliveredAt?.toISOString() ?? null,
    completedAt: l.completedAt?.toISOString() ?? null,
    marketplace: {
      onMarket: isLoadOnMarket(l.status),
      activeOfferCount: l.offerThreads.length,
      // The award columns are all written atomically together (see OffersService).
      award:
        l.awardedOfferRoundId && l.awardedOfferRound && l.carrierCompany
          ? {
              carrierCompanyId: l.carrierCompany.id,
              carrierName: l.carrierCompany.name,
              offerRoundId: l.awardedOfferRoundId,
              amount: money(l.bookedRate ?? l.awardedOfferRound.amount),
              currency: l.awardedOfferRound.currency,
              awardedAt: (l.awardedAt ?? l.updatedAt).toISOString(),
              assignedAt: l.assignedAt?.toISOString() ?? null,
            }
          : null,
    },
    audience: toAudienceView(l),
    commercialMode: l.commercialMode,
    postedRate: moneyOrNull(l.postedRate),
    ratePerMile: computeRatePerMile(l.postedRate?.toFixed(2) ?? null, metersToMiles(l.distanceMeters)),
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
    events: l.events.map(toEventView),
  };
}

// --- Shipments workspaces (Milestone 4 Phase 5) -----------------------------

export const shipmentListInclude = {
  origin: { select: { city: true, state: true } },
  destination: { select: { city: true, state: true } },
  shipperCompany: { select: { id: true, name: true } },
  carrierCompany: { select: { id: true, name: true } },
} satisfies Prisma.LoadInclude;

type ShipmentListRow = Prisma.LoadGetPayload<{ include: typeof shipmentListInclude }>;

export function toShipmentListItem(l: ShipmentListRow, side: ShipmentViewerSide): ShipmentListItem {
  return {
    id: l.id,
    referenceNumber: l.referenceNumber,
    status: l.status,
    origin: { city: l.origin.city, state: l.origin.state },
    destination: { city: l.destination.city, state: l.destination.state },
    pickupWindowStart: l.pickupWindowStart?.toISOString() ?? null,
    pickupWindowEnd: l.pickupWindowEnd?.toISOString() ?? null,
    deliveryWindowStart: l.deliveryWindowStart?.toISOString() ?? null,
    deliveryWindowEnd: l.deliveryWindowEnd?.toISOString() ?? null,
    shipperCompanyId: l.shipperCompany.id,
    shipperName: l.shipperCompany.name,
    carrierCompanyId: l.carrierCompany?.id ?? null,
    carrierName: l.carrierCompany?.name ?? null,
    bookedRate: moneyOrNull(l.bookedRate),
    nextAction: shipmentNextAction(l.status, side),
    updatedAt: l.updatedAt.toISOString(),
  };
}
