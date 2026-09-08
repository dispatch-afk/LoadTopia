import { randomUUID } from "node:crypto";
import type { Prisma } from "@loadtopia/db";

/**
 * Phase 1 of the two-phase Rate Confirmation write: the IMMUTABLE commercial
 * snapshot, inserted INSIDE `OffersService.accept()`'s existing award
 * transaction — the commercial agreement is created by offer acceptance, not by
 * the later carrier assignment.
 *
 * Coupled to the award on purpose: if this insert cannot succeed the whole
 * award transaction rolls back, so "exactly one snapshot per awarded load" is a
 * transactional guarantee, not application bookkeeping. `assign()` never calls
 * this and has no code path that could create a second one.
 *
 * There is NO storage or rendering here — phase 1 has zero external dependency,
 * so a storage outage can never block an award.
 */

export const RATE_CONFIRMATION_STORAGE_PREFIX = "rate-confirmations";

/**
 * Deterministic object key, derived only from the row's own immutable ids:
 * `rate-confirmations/{loadId}/{rateConfirmationId}.pdf`. Computed once, at
 * insert. A crash-and-retry of phase 2 always targets this exact key, so it
 * overwrites the same object rather than orphaning a duplicate.
 */
export function rateConfirmationStorageKey(loadId: string, rateConfirmationId: string): string {
  return `${RATE_CONFIRMATION_STORAGE_PREFIX}/${loadId}/${rateConfirmationId}.pdf`;
}

export interface RateConfirmationSnapshotArgs {
  loadId: string;
  /** The carrier company just awarded the load — authoritative, straight from
   *  the accepted thread (not re-derived from mutable membership state). */
  carrierCompanyId: string;
  awardedOfferRoundId: string;
  agreedRate: Prisma.Decimal;
  currency: string;
  /** The SAME `now` the caller already captured for `Load.awardedAt` /
   *  `OfferThread.closedAt` — never an independent `new Date()`. */
  awardedAt: Date;
}

/**
 * Insert the one immutable `rate_confirmations` row for a load that has just
 * been awarded, reading every commercial value from authoritative sources
 * available inside the award transaction. Missing optional values (MC/DOT,
 * legal name, commodity, weight, windows, mileage) are stored as null — never
 * invented.
 *
 * Runs entirely within `tx`. Throws if the load already has a Rate
 * Confirmation (the `load_id` unique constraint) — which, under the
 * currently-reachable lifecycle, can only happen on a duplicate award and
 * should roll the transaction back.
 */
export async function insertRateConfirmationSnapshot(
  tx: Prisma.TransactionClient,
  args: RateConfirmationSnapshotArgs,
): Promise<{ id: string; storageKey: string }> {
  const load = await tx.load.findUniqueOrThrow({
    where: { id: args.loadId },
    include: { origin: true, destination: true },
  });

  const [shipperCompany, carrierCompany, carrierProfile] = await Promise.all([
    tx.company.findUniqueOrThrow({
      where: { id: load.shipperCompanyId },
      select: { name: true, mcNumber: true, dotNumber: true },
    }),
    tx.company.findUniqueOrThrow({
      where: { id: args.carrierCompanyId },
      select: { name: true },
    }),
    // The authoritative freight-industry identity fields (Correction 1).
    tx.carrierProfile.findUnique({
      where: { companyId: args.carrierCompanyId },
      select: { legalName: true, mcNumber: true, dotNumber: true },
    }),
  ]);

  const id = randomUUID();
  const storageKey = rateConfirmationStorageKey(args.loadId, id);

  await tx.rateConfirmation.create({
    data: {
      id,
      loadId: args.loadId,
      referenceNumber: `RC-${load.referenceNumber}`,
      status: "PENDING",
      storageKey,
      generatedAt: null,

      shipperCompanyId: load.shipperCompanyId,
      shipperCompanyName: shipperCompany.name,
      shipperMcNumber: shipperCompany.mcNumber,
      shipperDotNumber: shipperCompany.dotNumber,

      carrierCompanyId: args.carrierCompanyId,
      carrierCompanyName: carrierCompany.name,
      carrierLegalName: carrierProfile?.legalName ?? null,
      carrierMcNumber: carrierProfile?.mcNumber ?? null,
      carrierDotNumber: carrierProfile?.dotNumber ?? null,

      originAddressLine1: load.origin.addressLine1,
      originAddressLine2: load.origin.addressLine2,
      originCity: load.origin.city,
      originState: load.origin.state,
      originPostalCode: load.origin.postalCode,
      originCountry: load.origin.country,

      destinationAddressLine1: load.destination.addressLine1,
      destinationAddressLine2: load.destination.addressLine2,
      destinationCity: load.destination.city,
      destinationState: load.destination.state,
      destinationPostalCode: load.destination.postalCode,
      destinationCountry: load.destination.country,

      pickupWindowStart: load.pickupWindowStart,
      pickupWindowEnd: load.pickupWindowEnd,
      deliveryWindowStart: load.deliveryWindowStart,
      deliveryWindowEnd: load.deliveryWindowEnd,

      equipmentType: load.equipmentType,
      commodity: load.commodity,
      weightLbs: load.weightLbs,

      agreedRate: args.agreedRate,
      currency: args.currency,
      distanceMeters: load.distanceMeters,

      awardedOfferRoundId: args.awardedOfferRoundId,
      awardedAt: args.awardedAt,
    },
  });

  return { id, storageKey };
}
