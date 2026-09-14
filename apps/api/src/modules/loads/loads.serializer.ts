import {
  computeRatePerMile,
  deriveShipmentPodState,
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
  // Milestone 4 Phase 6: the assigned carrier's operational view previously
  // never surfaced who the shipper actually is — a real gap for a guided
  // Shipment Detail. Cheap, same-query addition (no separate lookup).
  shipperCompany: { select: { name: true } },
  carrierCompany: { select: { id: true, name: true } },
  awardedOfferRound: { select: { amount: true, currency: true } },
  offerThreads: { where: { status: "ACTIVE" }, select: { id: true } },
  // EVERY confirmed, non-removed POD (any review status) — drives both
  // `completionReady`/whether COMPLETED is advertised AND the POD-aware
  // `shipmentNextAction` (Milestone 4 Phase 6), via `deriveShipmentPodState`.
  // Deliberately NOT `take: 1` — an already-APPROVED POD is permanent,
  // non-removable evidence, but nothing prevents a further, unrelated POD
  // being uploaded afterward (see deriveShipmentPodState's doc comment), so
  // "the latest row" alone could hide an approval that already satisfies
  // completion. A load carries very few POD rows in practice; this is a
  // single batched relation query either way (no N+1, no new round trip).
  // Indexed by (load_id, doc_type, review_status).
  documents: {
    where: { docType: "POD", confirmedAt: { not: null }, removedAt: null },
    select: { reviewStatus: true, confirmedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
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
  // The current POD state — deriveShipmentPodState already gives ANY active
  // APPROVED POD precedence over a newer PENDING_REVIEW/REJECTED one, so
  // this agrees with LoadsService#complete's own authoritative check (which
  // matches ANY active APPROVED POD, unordered) by construction.
  const podState = deriveShipmentPodState(
    l.documents.map((d) => ({
      docType: "POD",
      reviewStatus: d.reviewStatus,
      confirmedAt: d.confirmedAt,
      removedAt: null,
      createdAt: d.createdAt,
    })),
  );
  // Objective, actor-independent: this load is DELIVERED and has an active
  // APPROVED POD (podState === "APPROVED" iff one exists — see above), so
  // completion WOULD succeed for an authorized shipper. Matches
  // LoadsService#complete's own rule; that write-path check remains the
  // sole authority — this is a read-model mirror of it, never a substitute.
  const completionReady = l.status === LoadStatus.DELIVERED && podState === "APPROVED";

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
    shipperName: l.shipperCompany.name,
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
    // Same deterministic source as ShipmentListItem.nextAction — see
    // shipmentNextAction's doc comment. Only a shipper or carrier is ever
    // "responsible" for a next action; admin/other get a truthful null
    // rather than a guess at which side they'd stand in for.
    shipmentNextAction:
      viewerRole === "shipper" || viewerRole === "carrier"
        ? shipmentNextAction(l.status, viewerRole, podState)
        : null,
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
  // EVERY confirmed, non-removed POD — same shape/reasoning as
  // loadDetailInclude.documents (Milestone 4 Phase 6): lets the list's
  // `nextAction` agree with the authoritative completion rule (any active
  // APPROVED POD wins, regardless of anything uploaded after it — see
  // deriveShipmentPodState). One batched query per page via Prisma's
  // relation loading, never per-row (no N+1).
  documents: {
    where: { docType: "POD", confirmedAt: { not: null }, removedAt: null },
    select: { reviewStatus: true, confirmedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  },
} satisfies Prisma.LoadInclude;

type ShipmentListRow = Prisma.LoadGetPayload<{ include: typeof shipmentListInclude }>;

export function toShipmentListItem(l: ShipmentListRow, side: ShipmentViewerSide): ShipmentListItem {
  const podState = deriveShipmentPodState(
    l.documents.map((d) => ({
      docType: "POD",
      reviewStatus: d.reviewStatus,
      confirmedAt: d.confirmedAt,
      removedAt: null,
      createdAt: d.createdAt,
    })),
  );
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
    nextAction: shipmentNextAction(l.status, side, podState),
    updatedAt: l.updatedAt.toISOString(),
  };
}
