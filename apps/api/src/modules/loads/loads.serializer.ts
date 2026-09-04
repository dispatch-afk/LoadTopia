import { EXPOSED_LOAD_STATUSES, isLoadOnMarket, nextLoadStatuses } from "@loadtopia/domain";
import { type LoadEventView, type LoadListItem, type LoadView } from "@loadtopia/shared";
import type { Prisma } from "@loadtopia/db";
import { MOCK_PROVIDER_NAME } from "@loadtopia/providers";
import { money } from "../../lib/money";
import { toLocationView } from "../locations/locations.service";

const METERS_PER_MILE = 1609.344;

export function metersToMiles(meters: number | null): number | null {
  if (meters == null) return null;
  return Math.round((meters / METERS_PER_MILE) * 10) / 10;
}

export const loadListInclude = {
  origin: { select: { city: true, state: true } },
  destination: { select: { city: true, state: true } },
} satisfies Prisma.LoadInclude;

export const loadDetailInclude = {
  origin: true,
  destination: true,
  carrierCompany: { select: { id: true, name: true } },
  awardedOfferRound: { select: { amount: true, currency: true } },
  offerThreads: { where: { status: "ACTIVE" }, select: { id: true } },
  events: {
    orderBy: { createdAt: "asc" },
    include: { actor: { select: { firstName: true, lastName: true } } },
  },
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

export function toLoadView(l: LoadDetailRow): LoadView {
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
    availableTransitions: nextLoadStatuses(l.status).filter((s) => EXPOSED_LOAD_STATUSES.includes(s)),
    createdByUserId: l.createdByUserId,
    updatedByUserId: l.updatedByUserId,
    postedAt: l.postedAt?.toISOString() ?? null,
    cancelledAt: l.cancelledAt?.toISOString() ?? null,
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
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
    events: l.events.map(toEventView),
  };
}
