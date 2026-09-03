import { nextLoadStatuses } from "@loadtopia/domain";
import { LoadStatus, type LoadEventView, type LoadListItem, type LoadView } from "@loadtopia/shared";
import type { Prisma } from "@loadtopia/db";
import { toLocationView } from "../locations/locations.service";

/** Lifecycle states LoadTopia exposes in Milestone 1 (no marketplace states). */
export const M1_EXPOSED_STATUSES: readonly LoadStatus[] = [
  LoadStatus.DRAFT,
  LoadStatus.POSTED,
  LoadStatus.CANCELLED,
];

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

export function toLoadView(l: LoadDetailRow, isMockRouting: boolean): LoadView {
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
      isMock: l.routingProvider != null ? isMockRouting : false,
      routedAt: l.routedAt?.toISOString() ?? null,
    },
    availableTransitions: nextLoadStatuses(l.status).filter((s) =>
      M1_EXPOSED_STATUSES.includes(s),
    ),
    createdByUserId: l.createdByUserId,
    updatedByUserId: l.updatedByUserId,
    postedAt: l.postedAt?.toISOString() ?? null,
    cancelledAt: l.cancelledAt?.toISOString() ?? null,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
    events: l.events.map(toEventView),
  };
}
