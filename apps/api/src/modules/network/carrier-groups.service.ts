import type { PrismaClient } from "@loadtopia/db";
import {
  assertCompanyPrimaryAuthority,
  assertPermission,
  canAddCarrierToGroup,
  canonicalizeCompanyPair,
  NetworkError,
  Permission,
} from "@loadtopia/domain";
import {
  type AuthenticatedActor,
  type CarrierGroupDetailView,
  type CarrierGroupMemberView,
  type CarrierGroupView,
  CompanyBlockStatus,
  CompanyType,
} from "@loadtopia/shared";
import { conflict, forbidden, notFound } from "../../lib/errors";

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * A shipper company's PRIVATE, manual collection of its own connected
 * carriers. The carrier never sees the group's name or its own membership —
 * every read here is scoped to the OWNING shipper company only. Only
 * company-primary/admin authority may manage groups; any active member may
 * read them (consistent with Follow/Connection/Preference read access).
 */
export class CarrierGroupsService {
  constructor(private readonly prisma: PrismaClient) {}

  private async assertOwnedGroup(actor: AuthenticatedActor, groupId: string) {
    const group = await this.prisma.carrierGroup.findUnique({ where: { id: groupId } });
    if (!group || group.shipperCompanyId !== actor.companyId) throw notFound("Carrier group not found");
    return group;
  }

  async create(actor: AuthenticatedActor, name: string): Promise<CarrierGroupView> {
    assertPermission(actor, Permission.NETWORK_MANAGE);
    assertCompanyPrimaryAuthority(actor);
    if (actor.companyType !== CompanyType.SHIPPER) {
      throw forbidden("Only a shipper company may create Carrier Groups");
    }
    try {
      const row = await this.prisma.carrierGroup.create({
        data: { shipperCompanyId: actor.companyId!, name, normalizedName: normalize(name) },
      });
      return {
        id: row.id,
        name: row.name,
        memberCount: 0,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        throw conflict("A carrier group with that name already exists");
      }
      throw err;
    }
  }

  async update(actor: AuthenticatedActor, groupId: string, name: string): Promise<CarrierGroupView> {
    assertPermission(actor, Permission.NETWORK_MANAGE);
    assertCompanyPrimaryAuthority(actor);
    await this.assertOwnedGroup(actor, groupId);
    try {
      const row = await this.prisma.carrierGroup.update({
        where: { id: groupId },
        data: { name, normalizedName: normalize(name) },
        include: { _count: { select: { members: true } } },
      });
      return {
        id: row.id,
        name: row.name,
        memberCount: row._count.members,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        throw conflict("A carrier group with that name already exists");
      }
      throw err;
    }
  }

  /** Deleting a group removes its memberships (Cascade) — it does NOT
   *  disconnect or block any carrier; group membership is not commercial
   *  history. */
  async remove(actor: AuthenticatedActor, groupId: string): Promise<void> {
    assertPermission(actor, Permission.NETWORK_MANAGE);
    assertCompanyPrimaryAuthority(actor);
    await this.assertOwnedGroup(actor, groupId);
    await this.prisma.carrierGroup.delete({ where: { id: groupId } });
  }

  async list(actor: AuthenticatedActor): Promise<CarrierGroupView[]> {
    assertPermission(actor, Permission.NETWORK_REQUEST);
    const rows = await this.prisma.carrierGroup.findMany({
      where: { shipperCompanyId: actor.companyId! },
      include: { _count: { select: { members: true } } },
      orderBy: { name: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      memberCount: r._count.members,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async getById(actor: AuthenticatedActor, groupId: string): Promise<CarrierGroupDetailView> {
    assertPermission(actor, Permission.NETWORK_REQUEST);
    const group = await this.assertOwnedGroup(actor, groupId);
    const members = await this.prisma.carrierGroupMember.findMany({
      where: { groupId },
      include: { carrierCompany: { select: { name: true } } },
      orderBy: { addedAt: "asc" },
    });
    const memberViews: CarrierGroupMemberView[] = members.map((m) => ({
      carrierCompanyId: m.carrierCompanyId,
      carrierCompanyName: m.carrierCompany.name,
      addedAt: m.addedAt.toISOString(),
    }));
    return {
      id: group.id,
      name: group.name,
      memberCount: memberViews.length,
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
      members: memberViews,
    };
  }

  async addMember(
    actor: AuthenticatedActor,
    groupId: string,
    carrierCompanyId: string,
  ): Promise<CarrierGroupMemberView> {
    assertPermission(actor, Permission.NETWORK_MANAGE);
    assertCompanyPrimaryAuthority(actor);
    const myCompanyId = actor.companyId!;
    await this.assertOwnedGroup(actor, groupId);

    const carrier = await this.prisma.company.findUnique({ where: { id: carrierCompanyId } });
    if (!carrier) throw notFound("Company not found");

    const pair = canonicalizeCompanyPair(myCompanyId, carrierCompanyId);
    const connection = await this.prisma.companyConnection.findUnique({
      where: { companyAId_companyBId: { companyAId: pair.companyAId, companyBId: pair.companyBId } },
    });
    const block = await this.prisma.companyBlock.findFirst({
      where: {
        status: { in: [CompanyBlockStatus.ACTIVE, CompanyBlockStatus.PENDING_ON_COMPLETION] },
        OR: [
          { blockingCompanyId: myCompanyId, blockedCompanyId: carrierCompanyId },
          { blockingCompanyId: carrierCompanyId, blockedCompanyId: myCompanyId },
        ],
      },
    });

    const eligibility = canAddCarrierToGroup({
      connectionStatus: connection?.status ?? null,
      blockStatus: block?.status ?? null,
    });
    if (!eligibility.eligible) {
      const message =
        eligibility.reason === "BLOCKED"
          ? "This carrier cannot be added while a block is in force between the two companies"
          : "Only a carrier with an ACCEPTED connection may be added to a group";
      throw new NetworkError(message);
    }

    try {
      const member = await this.prisma.carrierGroupMember.create({ data: { groupId, carrierCompanyId } });
      return {
        carrierCompanyId,
        carrierCompanyName: carrier.name,
        addedAt: member.addedAt.toISOString(),
      };
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        throw conflict("This carrier is already a member of the group");
      }
      throw err;
    }
  }

  /** Idempotent — removing a carrier not in the group is a no-op. Does NOT
   *  disconnect the carrier. */
  async removeMember(actor: AuthenticatedActor, groupId: string, carrierCompanyId: string): Promise<void> {
    assertPermission(actor, Permission.NETWORK_MANAGE);
    assertCompanyPrimaryAuthority(actor);
    await this.assertOwnedGroup(actor, groupId);
    await this.prisma.carrierGroupMember.deleteMany({ where: { groupId, carrierCompanyId } });
  }
}
