import type { Prisma } from "@loadtopia/db";
import { computeRatePerMile } from "@loadtopia/domain";
import { MOCK_PROVIDER_NAME } from "@loadtopia/providers";
import type { MarketplaceLoadListItem, OfferThreadSummary } from "@loadtopia/shared";
import { moneyOrNull } from "../../lib/money";
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
  shipperIsConnected: boolean,
): MarketplaceLoadListItem {
  const miles = metersToMiles(l.distanceMeters);
  const postedRate = moneyOrNull(l.postedRate);
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
    miles,
    driveTimeMinutes: l.driveTimeMinutes,
    // Derived from the PROVIDER NAME STORED ON THIS LOAD, never the currently
    // configured provider — mirrors loads.serializer.ts's toLoadView() exactly.
    routing: { provider: l.routingProvider, isMock: l.routingProvider === MOCK_PROVIDER_NAME },
    shipperCompanyId: l.shipperCompanyId,
    shipperName: l.shipperCompany.name,
    shipperIsConnected,
    postedAt: l.postedAt?.toISOString() ?? null,
    myThread,
    // Commercial agreement (Milestone 4 Phase 5). `postedRate` is naturally
    // null for a REQUEST_OFFERS load (the invariant is enforced server-side
    // at write time — see assertValidCommercialMode) — never filtered here.
    commercialMode: l.commercialMode,
    postedRate,
    ratePerMile: computeRatePerMile(postedRate, miles),
  };
}
