import type { PrismaClient } from "@loadtopia/db";
import type { CarrierEligibilityContext } from "@loadtopia/domain";
import type { AuthenticatedActor } from "@loadtopia/shared";

/**
 * Load the facts the pure eligibility functions need for a carrier company:
 * its type + active state and (if any) its marketplace profile. The
 * membership-active / permission checks are handled separately at the API layer.
 */
export async function loadCarrierEligibilityContext(
  prisma: PrismaClient,
  companyId: string,
): Promise<CarrierEligibilityContext> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      type: true,
      memberships: { where: { isActive: true }, select: { id: true }, take: 1 },
      carrierProfile: {
        select: {
          operatingStatus: true,
          marketplaceEligibility: true,
          equipmentTypes: true,
          serviceAreaStates: true,
        },
      },
    },
  });

  return {
    companyType: company?.type ?? null,
    companyActive: (company?.memberships.length ?? 0) > 0,
    profile: company?.carrierProfile
      ? {
          operatingStatus: company.carrierProfile.operatingStatus,
          marketplaceEligibility: company.carrierProfile.marketplaceEligibility,
          equipmentTypes: company.carrierProfile.equipmentTypes,
          serviceAreaStates: company.carrierProfile.serviceAreaStates,
        }
      : null,
  };
}

export function actorCarrierCompanyId(actor: AuthenticatedActor): string | null {
  return actor.companyType === "CARRIER" ? actor.companyId : null;
}
