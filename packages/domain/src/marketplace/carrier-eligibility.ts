import {
  CarrierOperatingStatus,
  CompanyType,
  type EquipmentType,
  LoadStatus,
  MarketplaceEligibility,
  type UserRole,
} from "@loadtopia/shared";

/**
 * Server-authoritative carrier eligibility. A carrier does NOT automatically get
 * access to every posted load — every check here must pass. Pure function: the
 * API layer supplies the facts (from the DB / the authenticated actor) and maps
 * the result to responses. Add new checks by extending `EligibilityReason` and
 * the `reasons` list — call sites do not change.
 */
export const EligibilityReason = {
  NOT_A_CARRIER: "NOT_A_CARRIER",
  CARRIER_COMPANY_INACTIVE: "CARRIER_COMPANY_INACTIVE",
  PROFILE_MISSING: "PROFILE_MISSING",
  PROFILE_NOT_ELIGIBLE: "PROFILE_NOT_ELIGIBLE",
  CARRIER_NOT_OPERATING: "CARRIER_NOT_OPERATING",
  EQUIPMENT_INCOMPATIBLE: "EQUIPMENT_INCOMPATIBLE",
  SERVICE_AREA_MISMATCH: "SERVICE_AREA_MISMATCH",
  LOAD_NOT_ON_MARKET: "LOAD_NOT_ON_MARKET",
  LOAD_ALREADY_AWARDED: "LOAD_ALREADY_AWARDED",
} as const;
export type EligibilityReason = (typeof EligibilityReason)[keyof typeof EligibilityReason];

export interface CarrierEligibilityContext {
  companyType: CompanyType | null;
  companyActive: boolean;
  /** null when the CARRIER company has not created a marketplace profile yet. */
  profile: {
    operatingStatus: CarrierOperatingStatus;
    marketplaceEligibility: MarketplaceEligibility;
    equipmentTypes: EquipmentType[];
    serviceAreaStates: string[];
  } | null;
}

export interface LoadEligibilityView {
  status: LoadStatus;
  equipmentType: EquipmentType;
  originState: string;
}

/** Load states in which a carrier may still discover / offer on a load. */
export const MARKETPLACE_VISIBLE_STATUSES: readonly LoadStatus[] = [
  LoadStatus.POSTED,
  LoadStatus.OFFER_RECEIVED,
];

export interface EligibilityResult {
  eligible: boolean;
  reasons: EligibilityReason[];
}

export function isLoadOnMarket(status: LoadStatus): boolean {
  return MARKETPLACE_VISIBLE_STATUSES.includes(status);
}

export function isCarrierEligibleForLoad(
  carrier: CarrierEligibilityContext,
  load: LoadEligibilityView,
): EligibilityResult {
  const reasons: EligibilityReason[] = [];

  if (carrier.companyType !== CompanyType.CARRIER) {
    reasons.push(EligibilityReason.NOT_A_CARRIER);
  }
  if (!carrier.companyActive) {
    reasons.push(EligibilityReason.CARRIER_COMPANY_INACTIVE);
  }

  if (!carrier.profile) {
    reasons.push(EligibilityReason.PROFILE_MISSING);
  } else {
    if (carrier.profile.marketplaceEligibility !== MarketplaceEligibility.ELIGIBLE) {
      reasons.push(EligibilityReason.PROFILE_NOT_ELIGIBLE);
    }
    if (carrier.profile.operatingStatus !== CarrierOperatingStatus.ACTIVE) {
      reasons.push(EligibilityReason.CARRIER_NOT_OPERATING);
    }
    const equip = carrier.profile.equipmentTypes;
    if (equip.length > 0 && !equip.includes(load.equipmentType)) {
      reasons.push(EligibilityReason.EQUIPMENT_INCOMPATIBLE);
    }
    const area = carrier.profile.serviceAreaStates;
    if (area.length > 0 && !area.includes(load.originState.toUpperCase())) {
      reasons.push(EligibilityReason.SERVICE_AREA_MISMATCH);
    }
  }

  if (load.status === LoadStatus.AWARDED || load.status === LoadStatus.CARRIER_ASSIGNED) {
    reasons.push(EligibilityReason.LOAD_ALREADY_AWARDED);
  } else if (!isLoadOnMarket(load.status)) {
    reasons.push(EligibilityReason.LOAD_NOT_ON_MARKET);
  }

  return { eligible: reasons.length === 0, reasons };
}

/** Coarse "can this actor participate in the marketplace at all" (board access). */
export function carrierMarketplaceAccess(
  carrier: CarrierEligibilityContext,
  role: UserRole,
): EligibilityResult {
  const reasons: EligibilityReason[] = [];
  if (role !== "CARRIER" || carrier.companyType !== CompanyType.CARRIER) {
    reasons.push(EligibilityReason.NOT_A_CARRIER);
  }
  if (!carrier.companyActive) reasons.push(EligibilityReason.CARRIER_COMPANY_INACTIVE);
  if (!carrier.profile) {
    reasons.push(EligibilityReason.PROFILE_MISSING);
  } else if (carrier.profile.marketplaceEligibility !== MarketplaceEligibility.ELIGIBLE) {
    reasons.push(EligibilityReason.PROFILE_NOT_ELIGIBLE);
  }
  return { eligible: reasons.length === 0, reasons };
}
