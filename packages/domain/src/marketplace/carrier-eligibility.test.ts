import {
  CarrierOperatingStatus,
  CompanyType,
  EquipmentType,
  LoadStatus,
  MarketplaceEligibility,
} from "@loadtopia/shared";
import { describe, expect, it } from "vitest";
import {
  type CarrierEligibilityContext,
  EligibilityReason,
  carrierMarketplaceAccess,
  isCarrierEligibleForLoad,
  isLoadOnMarket,
} from "./carrier-eligibility";

const eligibleCarrier: CarrierEligibilityContext = {
  companyType: CompanyType.CARRIER,
  companyActive: true,
  profile: {
    operatingStatus: CarrierOperatingStatus.ACTIVE,
    marketplaceEligibility: MarketplaceEligibility.ELIGIBLE,
    equipmentTypes: [],
    serviceAreaStates: [],
  },
};

const postedLoad = {
  status: LoadStatus.POSTED,
  equipmentType: EquipmentType.DRY_VAN,
  originState: "IL",
};

describe("isCarrierEligibleForLoad", () => {
  it("passes for an eligible carrier and a load on the market", () => {
    expect(isCarrierEligibleForLoad(eligibleCarrier, postedLoad)).toEqual({
      eligible: true,
      reasons: [],
    });
    expect(isCarrierEligibleForLoad(eligibleCarrier, { ...postedLoad, status: LoadStatus.OFFER_RECEIVED }).eligible).toBe(true);
  });

  it("rejects a non-carrier company", () => {
    const r = isCarrierEligibleForLoad({ ...eligibleCarrier, companyType: CompanyType.SHIPPER }, postedLoad);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain(EligibilityReason.NOT_A_CARRIER);
  });

  it("rejects an inactive carrier company", () => {
    expect(
      isCarrierEligibleForLoad({ ...eligibleCarrier, companyActive: false }, postedLoad).reasons,
    ).toContain(EligibilityReason.CARRIER_COMPANY_INACTIVE);
  });

  it("rejects a carrier with no profile", () => {
    expect(
      isCarrierEligibleForLoad({ ...eligibleCarrier, profile: null }, postedLoad).reasons,
    ).toContain(EligibilityReason.PROFILE_MISSING);
  });

  it("rejects a carrier whose profile is not ELIGIBLE", () => {
    for (const e of [MarketplaceEligibility.PENDING, MarketplaceEligibility.INELIGIBLE, MarketplaceEligibility.SUSPENDED]) {
      const r = isCarrierEligibleForLoad(
        { ...eligibleCarrier, profile: { ...eligibleCarrier.profile!, marketplaceEligibility: e } },
        postedLoad,
      );
      expect(r.reasons).toContain(EligibilityReason.PROFILE_NOT_ELIGIBLE);
    }
  });

  it("rejects a carrier not currently operating", () => {
    expect(
      isCarrierEligibleForLoad(
        { ...eligibleCarrier, profile: { ...eligibleCarrier.profile!, operatingStatus: CarrierOperatingStatus.INACTIVE } },
        postedLoad,
      ).reasons,
    ).toContain(EligibilityReason.CARRIER_NOT_OPERATING);
  });

  it("enforces declared equipment compatibility (empty list = any)", () => {
    const reefOnly = { ...eligibleCarrier.profile!, equipmentTypes: [EquipmentType.REEFER] };
    expect(
      isCarrierEligibleForLoad({ ...eligibleCarrier, profile: reefOnly }, postedLoad).reasons,
    ).toContain(EligibilityReason.EQUIPMENT_INCOMPATIBLE);
    expect(
      isCarrierEligibleForLoad(
        { ...eligibleCarrier, profile: reefOnly },
        { ...postedLoad, equipmentType: EquipmentType.REEFER },
      ).eligible,
    ).toBe(true);
  });

  it("enforces declared service area against the load origin (empty list = nationwide)", () => {
    const midwest = { ...eligibleCarrier.profile!, serviceAreaStates: ["IL", "IN", "WI"] };
    expect(isCarrierEligibleForLoad({ ...eligibleCarrier, profile: midwest }, postedLoad).eligible).toBe(true);
    expect(
      isCarrierEligibleForLoad({ ...eligibleCarrier, profile: midwest }, { ...postedLoad, originState: "TX" }).reasons,
    ).toContain(EligibilityReason.SERVICE_AREA_MISMATCH);
  });

  it("rejects a load not on the market / already awarded", () => {
    expect(
      isCarrierEligibleForLoad(eligibleCarrier, { ...postedLoad, status: LoadStatus.DRAFT }).reasons,
    ).toContain(EligibilityReason.LOAD_NOT_ON_MARKET);
    expect(
      isCarrierEligibleForLoad(eligibleCarrier, { ...postedLoad, status: LoadStatus.CANCELLED }).reasons,
    ).toContain(EligibilityReason.LOAD_NOT_ON_MARKET);
    expect(
      isCarrierEligibleForLoad(eligibleCarrier, { ...postedLoad, status: LoadStatus.AWARDED }).reasons,
    ).toContain(EligibilityReason.LOAD_ALREADY_AWARDED);
  });
});

describe("carrierMarketplaceAccess", () => {
  it("grants board access to an eligible CARRIER-role actor only", () => {
    expect(carrierMarketplaceAccess(eligibleCarrier, "CARRIER").eligible).toBe(true);
    expect(carrierMarketplaceAccess(eligibleCarrier, "SHIPPER").reasons).toContain(
      EligibilityReason.NOT_A_CARRIER,
    );
    expect(carrierMarketplaceAccess({ ...eligibleCarrier, profile: null }, "CARRIER").eligible).toBe(false);
  });
});

describe("isLoadOnMarket", () => {
  it("is true only for POSTED / OFFER_RECEIVED", () => {
    expect(isLoadOnMarket(LoadStatus.POSTED)).toBe(true);
    expect(isLoadOnMarket(LoadStatus.OFFER_RECEIVED)).toBe(true);
    expect(isLoadOnMarket(LoadStatus.DRAFT)).toBe(false);
    expect(isLoadOnMarket(LoadStatus.AWARDED)).toBe(false);
    expect(isLoadOnMarket(LoadStatus.CANCELLED)).toBe(false);
  });
});
