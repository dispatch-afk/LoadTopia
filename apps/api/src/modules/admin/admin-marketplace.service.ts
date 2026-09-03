import type { PrismaClient } from "@loadtopia/db";
import { collectProviderHealth, type ProviderRegistry } from "@loadtopia/providers";
import {
  type AdminCarrierProfileRow,
  type AdminMarketplaceOverview,
  type AdminSetEligibilityInput,
  type CarrierProfileView,
  LoadStatus,
  MarketplaceEligibility,
} from "@loadtopia/shared";
import { notFound } from "../../lib/errors";
import { toCarrierProfileView } from "../carrier/carrier-profile.service";

/**
 * Platform-staff marketplace operations: inspect carrier profiles, override
 * eligibility, and read an aggregate overview. Every method here is reached only
 * behind the `marketplace:admin` permission (ADMIN role only).
 */
export class AdminMarketplaceService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly providers: ProviderRegistry,
  ) {}

  async listCarrierProfiles(): Promise<AdminCarrierProfileRow[]> {
    const profiles = await this.prisma.carrierProfile.findMany({
      include: { company: { select: { name: true } } },
      orderBy: [{ marketplaceEligibility: "asc" }, { updatedAt: "desc" }],
    });

    const activeByCarrier = await this.prisma.offerThread.groupBy({
      by: ["carrierCompanyId"],
      where: { status: "ACTIVE" },
      _count: { _all: true },
    });
    const activeMap = new Map(activeByCarrier.map((r) => [r.carrierCompanyId, r._count._all]));

    return profiles.map((p) => ({
      companyId: p.companyId,
      companyName: p.company.name,
      legalName: p.legalName,
      mcNumber: p.mcNumber,
      dotNumber: p.dotNumber,
      operatingStatus: p.operatingStatus,
      marketplaceEligibility: p.marketplaceEligibility,
      verificationStatus: p.verificationStatus,
      verificationIsMock: p.verificationIsMock,
      activeOffers: activeMap.get(p.companyId) ?? 0,
      updatedAt: p.updatedAt.toISOString(),
    }));
  }

  async setEligibility(
    companyId: string,
    input: AdminSetEligibilityInput,
    actorUserId: string,
  ): Promise<CarrierProfileView> {
    const existing = await this.prisma.carrierProfile.findUnique({ where: { companyId } });
    if (!existing) throw notFound("Carrier profile not found");

    const updated = await this.prisma.carrierProfile.update({
      where: { companyId },
      data: {
        marketplaceEligibility: input.marketplaceEligibility,
        eligibilityReason:
          input.reason?.slice(0, 500) ?? `set to ${input.marketplaceEligibility} by staff`,
      },
    });
    void actorUserId; // audit is written at the route layer
    return toCarrierProfileView(updated);
  }

  async overview(): Promise<AdminMarketplaceOverview> {
    const [loadGroups, threadGroups, profileGroups, health] = await Promise.all([
      this.prisma.load.groupBy({
        by: ["status"],
        where: {
          status: {
            in: [
              LoadStatus.POSTED,
              LoadStatus.OFFER_RECEIVED,
              LoadStatus.AWARDED,
              LoadStatus.CARRIER_ASSIGNED,
            ],
          },
        },
        _count: { _all: true },
      }),
      this.prisma.offerThread.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.carrierProfile.groupBy({
        by: ["marketplaceEligibility"],
        _count: { _all: true },
      }),
      collectProviderHealth(this.providers),
    ]);

    const loadCount = (s: LoadStatus) =>
      loadGroups.find((g) => g.status === s)?._count._all ?? 0;
    const threadCount = (s: string) =>
      threadGroups.find((g) => g.status === s)?._count._all ?? 0;

    const carrierProfiles = Object.fromEntries(
      Object.values(MarketplaceEligibility).map((e) => [
        e,
        profileGroups.find((g) => g.marketplaceEligibility === e)?._count._all ?? 0,
      ]),
    ) as Record<MarketplaceEligibility, number>;

    return {
      loads: {
        posted: loadCount(LoadStatus.POSTED),
        offerReceived: loadCount(LoadStatus.OFFER_RECEIVED),
        awarded: loadCount(LoadStatus.AWARDED),
        carrierAssigned: loadCount(LoadStatus.CARRIER_ASSIGNED),
      },
      offers: {
        activeThreads: threadCount("ACTIVE"),
        acceptedThreads: threadCount("ACCEPTED"),
      },
      carrierProfiles,
      providers: Object.fromEntries(
        (["pricing", "carrierVerification"] as const)
          .filter((k) => health[k])
          .map((k) => [k, health[k]!]),
      ),
    };
  }
}
