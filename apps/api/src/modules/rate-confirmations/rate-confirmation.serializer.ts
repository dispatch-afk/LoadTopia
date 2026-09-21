import type { RateConfirmation } from "@loadtopia/db";
import type {
  OfferThreadOriginType,
  RateConfirmationStatus,
  RateConfirmationView,
} from "@loadtopia/shared";

/**
 * Serialize the IMMUTABLE `rate_confirmations` snapshot. Every value here is a
 * direct read of the stored row — never recomputed from current mutable
 * load/company/offer data. `agreementSource` is the ONE exception: it is a
 * derived, read-only fact from the awarded OfferRound's thread (Milestone 4
 * Phase 6) — never stored on this row, never written back to it.
 */
export function toRateConfirmationView(
  rc: RateConfirmation,
  download: { url: string; expiresAt: string } | null,
  agreementSource: OfferThreadOriginType,
): RateConfirmationView {
  return {
    loadId: rc.loadId,
    referenceNumber: rc.referenceNumber,
    status: rc.status as RateConfirmationStatus,
    awardedAt: rc.awardedAt.toISOString(),
    agreedRate: rc.agreedRate.toFixed(2),
    currency: rc.currency,
    distanceMeters: rc.distanceMeters,
    shipper: {
      companyName: rc.shipperCompanyName,
      mcNumber: rc.shipperMcNumber,
      dotNumber: rc.shipperDotNumber,
    },
    carrier: {
      companyName: rc.carrierCompanyName,
      legalName: rc.carrierLegalName,
      mcNumber: rc.carrierMcNumber,
      dotNumber: rc.carrierDotNumber,
    },
    origin: {
      addressLine1: rc.originAddressLine1,
      addressLine2: rc.originAddressLine2,
      city: rc.originCity,
      state: rc.originState,
      postalCode: rc.originPostalCode,
      country: rc.originCountry,
    },
    destination: {
      addressLine1: rc.destinationAddressLine1,
      addressLine2: rc.destinationAddressLine2,
      city: rc.destinationCity,
      state: rc.destinationState,
      postalCode: rc.destinationPostalCode,
      country: rc.destinationCountry,
    },
    pickupWindowStart: rc.pickupWindowStart?.toISOString() ?? null,
    pickupWindowEnd: rc.pickupWindowEnd?.toISOString() ?? null,
    deliveryWindowStart: rc.deliveryWindowStart?.toISOString() ?? null,
    deliveryWindowEnd: rc.deliveryWindowEnd?.toISOString() ?? null,
    equipmentType: rc.equipmentType,
    commodity: rc.commodity,
    weightLbs: rc.weightLbs,
    agreementSource,
    download,
    documentPending: download === null,
  };
}
