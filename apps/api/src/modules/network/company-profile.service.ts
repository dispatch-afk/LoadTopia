import type { PrismaClient } from "@loadtopia/db";
import { assertPermission, canonicalizeCompanyPair, Permission } from "@loadtopia/domain";
import {
  type AuthenticatedActor,
  type CompanyProfileView,
  CompanyBlockStatus,
  type CompanyCapabilitiesView,
  CompanyType,
  ConnectionStatus,
} from "@loadtopia/shared";
import { notFound } from "../../lib/errors";
import { getRecentSharedLanes, getSharedHistorySummary, ZERO_SHARED_HISTORY } from "./shared-history.query";

const connectionInclude = {
  companyA: { select: { name: true } },
  companyB: { select: { name: true } },
} as const;

/**
 * Unified Company Profile / Relationship Profile payload — ONE endpoint per
 * companyId whose content adapts to relationship state and the viewer's own
 * company type, rather than separate profile/relationship endpoints (per
 * the Phase 3 IA: one route, adapting content).
 *
 * Privacy: every field under `relationship` reflects the VIEWER's own
 * private state toward the profiled company — never the reverse. A carrier
 * viewing a shipper's profile can never see that shipper's preference on the
 * carrier, its blocks, or its Carrier Group membership, because those
 * branches are only populated when `actor.companyType` is the side that
 * could legitimately hold that private state.
 */
export class CompanyProfileService {
  constructor(private readonly prisma: PrismaClient) {}

  async getProfile(actor: AuthenticatedActor, companyId: string): Promise<CompanyProfileView> {
    assertPermission(actor, Permission.NETWORK_REQUEST);
    const myCompanyId = actor.companyId!;

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: { carrierProfile: true },
    });
    if (!company) throw notFound("Company not found");

    const capabilities: CompanyCapabilitiesView | null =
      company.type === CompanyType.CARRIER && company.carrierProfile
        ? {
            legalName: company.carrierProfile.legalName,
            equipmentTypes: company.carrierProfile.equipmentTypes,
            serviceAreaStates: company.carrierProfile.serviceAreaStates,
          }
        : null;

    const isSelf = companyId === myCompanyId;

    let connection: CompanyProfileView["relationship"]["connection"] = null;
    let connectionEvents: CompanyProfileView["relationship"]["connectionEvents"] = [];
    let isFollowing: boolean | null = null;
    let preference: CompanyProfileView["relationship"]["preference"] = null;
    let blockStatus: CompanyBlockStatus | null = null;
    let groups: CompanyProfileView["relationship"]["groups"] = null;
    let sharedHistorySummary = ZERO_SHARED_HISTORY;
    let recentLanes: CompanyProfileView["sharedHistory"]["recentLanes"] = [];

    if (!isSelf) {
      const pair = canonicalizeCompanyPair(myCompanyId, companyId);
      const connectionRow = await this.prisma.companyConnection.findUnique({
        where: { companyAId_companyBId: { companyAId: pair.companyAId, companyBId: pair.companyBId } },
        include: connectionInclude,
      });

      if (connectionRow) {
        const counterpartName =
          connectionRow.companyAId === myCompanyId ? connectionRow.companyB.name : connectionRow.companyA.name;
        connection = {
          id: connectionRow.id,
          companyAId: connectionRow.companyAId,
          companyBId: connectionRow.companyBId,
          counterpartCompanyId: companyId,
          counterpartCompanyName: counterpartName,
          status: connectionRow.status,
          requesterCompanyId: connectionRow.requesterCompanyId,
          awaitingMyResponse:
            connectionRow.status === ConnectionStatus.PENDING &&
            connectionRow.requesterCompanyId !== myCompanyId,
          requestedAt: connectionRow.requestedAt.toISOString(),
          respondedAt: connectionRow.respondedAt?.toISOString() ?? null,
          disconnectedAt: connectionRow.disconnectedAt?.toISOString() ?? null,
          createdAt: connectionRow.createdAt.toISOString(),
          updatedAt: connectionRow.updatedAt.toISOString(),
          sharedHistory: ZERO_SHARED_HISTORY, // filled in below alongside the rest
        };
        const events = await this.prisma.companyConnectionEvent.findMany({
          where: { connectionId: connectionRow.id },
          orderBy: { createdAt: "asc" },
        });
        connectionEvents = events.map((e) => ({
          id: e.id,
          type: e.type,
          actorCompanyId: e.actorCompanyId,
          createdAt: e.createdAt.toISOString(),
        }));
      }

      if (actor.companyType === CompanyType.CARRIER && company.type === CompanyType.SHIPPER) {
        const follow = await this.prisma.carrierFollow.findUnique({
          where: {
            carrierCompanyId_shipperCompanyId: { carrierCompanyId: myCompanyId, shipperCompanyId: companyId },
          },
        });
        isFollowing = follow !== null;
      }

      if (actor.companyType === CompanyType.SHIPPER && company.type === CompanyType.CARRIER) {
        const pref = await this.prisma.carrierPreference.findUnique({
          where: {
            shipperCompanyId_carrierCompanyId: { shipperCompanyId: myCompanyId, carrierCompanyId: companyId },
          },
        });
        preference = pref?.preference ?? null;

        const memberships = await this.prisma.carrierGroupMember.findMany({
          where: { carrierCompanyId: companyId, group: { shipperCompanyId: myCompanyId } },
          include: { group: { select: { id: true, name: true } } },
        });
        groups = memberships.map((m) => ({ id: m.group.id, name: m.group.name }));
      }

      const myBlock = await this.prisma.companyBlock.findFirst({
        where: {
          blockingCompanyId: myCompanyId,
          blockedCompanyId: companyId,
          status: { in: [CompanyBlockStatus.ACTIVE, CompanyBlockStatus.PENDING_ON_COMPLETION] },
        },
      });
      blockStatus = myBlock?.status ?? null;

      [sharedHistorySummary, recentLanes] = await Promise.all([
        getSharedHistorySummary(this.prisma, myCompanyId, companyId),
        getRecentSharedLanes(this.prisma, myCompanyId, companyId),
      ]);
      if (connection) connection = { ...connection, sharedHistory: sharedHistorySummary };
    }

    return {
      id: company.id,
      type: company.type,
      name: company.name,
      city: company.city,
      state: company.state,
      memberSince: company.createdAt.toISOString(),
      capabilities,
      relationship: {
        connection,
        connectionEvents,
        isFollowing,
        preference,
        blockStatus,
        groups,
      },
      sharedHistory: { ...sharedHistorySummary, recentLanes },
    };
  }
}
