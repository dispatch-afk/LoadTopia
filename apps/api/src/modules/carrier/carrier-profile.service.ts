import type { Prisma, PrismaClient } from "@loadtopia/db";
import type { CarrierVerificationProvider } from "@loadtopia/providers";
import {
  CarrierVerificationStatus,
  type CarrierProfileView,
  CompanyType,
  MarketplaceEligibility,
  type UpsertCarrierProfileInput,
} from "@loadtopia/shared";
import { badRequest, conflict, notFound } from "../../lib/errors";

type ProfileRow = Prisma.CarrierProfileGetPayload<Record<string, never>>;

export function toCarrierProfileView(p: ProfileRow): CarrierProfileView {
  return {
    id: p.id,
    companyId: p.companyId,
    legalName: p.legalName,
    mcNumber: p.mcNumber,
    dotNumber: p.dotNumber,
    operatingStatus: p.operatingStatus,
    marketplaceEligibility: p.marketplaceEligibility,
    eligibilityReason: p.eligibilityReason,
    verification: {
      status: p.verificationStatus,
      provider: p.verificationProvider,
      isMock: p.verificationIsMock,
      note: p.verificationNote,
      verifiedAt: p.verifiedAt?.toISOString() ?? null,
    },
    equipmentTypes: p.equipmentTypes,
    serviceAreaStates: p.serviceAreaStates,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export class CarrierProfileService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly verifier: CarrierVerificationProvider,
  ) {}

  async getOwn(companyId: string, companyType: CompanyType | null): Promise<CarrierProfileView | null> {
    if (companyType !== CompanyType.CARRIER) {
      throw badRequest("Only carrier companies have a marketplace profile");
    }
    const p = await this.prisma.carrierProfile.findUnique({ where: { companyId } });
    return p ? toCarrierProfileView(p) : null;
  }

  /**
   * Create or replace the carrier's own profile. Changing identity/capabilities
   * resets eligibility to PENDING and verification to UNVERIFIED — the carrier
   * must (re)verify. The client can never set eligibility or verification state.
   */
  async upsertOwn(
    companyId: string,
    companyType: CompanyType | null,
    input: UpsertCarrierProfileInput,
  ): Promise<CarrierProfileView> {
    if (companyType !== CompanyType.CARRIER) {
      throw conflict("Only carrier companies can create a marketplace profile");
    }
    const data = {
      legalName: input.legalName,
      mcNumber: input.mcNumber ?? null,
      dotNumber: input.dotNumber ?? null,
      operatingStatus: input.operatingStatus,
      equipmentTypes: input.equipmentTypes,
      serviceAreaStates: input.serviceAreaStates.map((s) => s.toUpperCase()),
      // Re-review required on every edit — the carrier re-verifies to become ELIGIBLE.
      marketplaceEligibility: MarketplaceEligibility.PENDING,
      eligibilityReason: null,
      verificationStatus: CarrierVerificationStatus.UNVERIFIED,
      verificationProvider: null,
      verificationIsMock: null,
      verificationRef: null,
      verificationNote: null,
      verifiedAt: null,
    } satisfies Prisma.CarrierProfileUncheckedUpdateInput;

    const profile = await this.prisma.carrierProfile.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data,
    });
    return toCarrierProfileView(profile);
  }

  /**
   * Run the CarrierVerificationProvider abstraction against the profile.
   * `verified` + active authority ⇒ VERIFIED + ELIGIBLE. Otherwise FAILED +
   * INELIGIBLE. The mock verdict is flagged `verification_is_mock` and its
   * disclaimer stored verbatim — it is never presented as government verification.
   */
  async verifyOwn(companyId: string): Promise<CarrierProfileView> {
    const profile = await this.prisma.carrierProfile.findUnique({ where: { companyId } });
    if (!profile) throw notFound("Create your carrier profile before requesting verification");

    const result = await this.verifier.verify({
      legalName: profile.legalName,
      mcNumber: profile.mcNumber ?? undefined,
      dotNumber: profile.dotNumber ?? undefined,
    });

    const passed = result.status === "verified" && result.authorityStatus === "active";
    const updated = await this.prisma.carrierProfile.update({
      where: { companyId },
      data: {
        verificationStatus: passed
          ? CarrierVerificationStatus.VERIFIED
          : CarrierVerificationStatus.FAILED,
        verificationProvider: result.provider,
        verificationIsMock: result.isMock,
        verificationRef: result.reference,
        verificationNote:
          [result.disclaimer, `verdict=${result.status}`, `authority=${result.authorityStatus}`]
            .filter(Boolean)
            .join(" · ")
            .slice(0, 1000) || null,
        verifiedAt: passed ? new Date() : null,
        marketplaceEligibility: passed
          ? MarketplaceEligibility.ELIGIBLE
          : MarketplaceEligibility.INELIGIBLE,
        eligibilityReason: passed
          ? null
          : `verification ${result.status}${result.isMock ? " (mock)" : ""}`,
      },
    });
    return toCarrierProfileView(updated);
  }
}
