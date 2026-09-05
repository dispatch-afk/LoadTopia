import type { Prisma } from "@loadtopia/db";
import { MOCK_PROVIDER_NAME } from "@loadtopia/providers";
import type { MarketplaceLoadListItem, OfferThreadSummary } from "@loadtopia/shared";
import { metersToMiles } from "../loads/loads.serializer";

export const METERS_PER_MILE = 1609.344;

export const marketplaceLoadInclude = {
  origin: { select: { city: true, state: true } },
  destination: { select: { city: true, state: true } },
  shipperCompany: { select: { name: true } },
} satisfies Prisma.LoadInclude;

export type MarketplaceLoadRow = Prisma.LoadGetPayload<{ include: typeof marketplaceLoadInclude }>;

export function toMarketplaceListItem(
  l: MarketplaceLoadRow,
  myThread: OfferThreadSummary | null,
): MarketplaceLoadListItem {
  return {
    id: l.id,
    referenceNumber: l.referenceNumber,
    status: l.status,
    equipmentType: l.equipmentType,
    mode: l.mode,
    commodity: l.commodity,
    weightLbs: l.weightLbs,
    origin: { city: l.origin.city, state: l.origin.state },
    destination: { city: l.destination.city, state: l.destination.state },
    pickupWindowStart: l.pickupWindowStart?.toISOString() ?? null,
    pickupWindowEnd: l.pickupWindowEnd?.toISOString() ?? null,
    deliveryWindowStart: l.deliveryWindowStart?.toISOString() ?? null,
    deliveryWindowEnd: l.deliveryWindowEnd?.toISOString() ?? null,
    miles: metersToMiles(l.distanceMeters),
    driveTimeMinutes: l.driveTimeMinutes,
    // Derived from the PROVIDER NAME STORED ON THIS LOAD, never the currently
    // configured provider — mirrors loads.serializer.ts's toLoadView() exactly.
    routing: { provider: l.routingProvider, isMock: l.routingProvider === MOCK_PROVIDER_NAME },
    shipperName: l.shipperCompany.name,
    postedAt: l.postedAt?.toISOString() ?? null,
    myThread,
  };
}
