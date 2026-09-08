import type { RateConfirmation } from "@loadtopia/db";
import type { RateConfirmationStatus, RateConfirmationView } from "@loadtopia/shared";

/**
 * Serialize the IMMUTABLE `rate_confirmations` snapshot. Every value here is a
 * direct read of the stored row — never recomputed from current mutable
 * load/company/offer data.
 */
export function toRateConfirmationView(
  rc: RateConfirmation,
  download: { url: string; expiresAt: string } | null,
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
    download,
    documentPending: download === null,
  };
}
