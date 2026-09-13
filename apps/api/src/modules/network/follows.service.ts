import type { PrismaClient } from "@loadtopia/db";
import { assertPermission, Permission } from "@loadtopia/domain";
import { type AuthenticatedActor, type CarrierFollowView, CompanyType } from "@loadtopia/shared";
import { badRequest, forbidden, notFound } from "../../lib/errors";

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string }).code === "P2002";
}

/**
 * Follow is PRIVATE to the following carrier company: one-sided, no
 * approval, grants no freight access, and the shipper is never told it was
 * followed. Hard-deleted on unfollow — this is a bookmark, not commercial
 * history worth preserving forever (unlike a Connection).
 */
export class FollowsService {
  constructor(private readonly prisma: PrismaClient) {}

  async follow(actor: AuthenticatedActor, shipperCompanyId: string): Promise<CarrierFollowView> {
    assertPermission(actor, Permission.NETWORK_REQUEST);
    if (actor.companyType !== CompanyType.CARRIER) {
      throw forbidden("Only a carrier company may follow a shipper");
    }
    const myCompanyId = actor.companyId!;
    if (shipperCompanyId === myCompanyId) throw badRequest("A company cannot follow itself");

    const shipper = await this.prisma.company.findUnique({ where: { id: shipperCompanyId } });
    if (!shipper) throw notFound("Company not found");
    if (shipper.type !== CompanyType.SHIPPER) {
      throw badRequest("Only a shipper company can be followed");
    }

    try {
      const row = await this.prisma.carrierFollow.create({
        data: { carrierCompanyId: myCompanyId, shipperCompanyId },
      });
      return {
        id: row.id,
        shipperCompanyId: row.shipperCompanyId,
        shipperCompanyName: shipper.name,
        createdAt: row.createdAt.toISOString(),
      };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Idempotent: already following.
      const existing = await this.prisma.carrierFollow.findUniqueOrThrow({
        where: { carrierCompanyId_shipperCompanyId: { carrierCompanyId: myCompanyId, shipperCompanyId } },
      });
      return {
        id: existing.id,
        shipperCompanyId: existing.shipperCompanyId,
        shipperCompanyName: shipper.name,
        createdAt: existing.createdAt.toISOString(),
      };
    }
  }

  /** Idempotent — unfollowing a company you don't follow is a no-op. */
  async unfollow(actor: AuthenticatedActor, shipperCompanyId: string): Promise<void> {
    assertPermission(actor, Permission.NETWORK_REQUEST);
    await this.prisma.carrierFollow.deleteMany({
      where: { carrierCompanyId: actor.companyId!, shipperCompanyId },
    });
  }

  async list(actor: AuthenticatedActor): Promise<CarrierFollowView[]> {
    assertPermission(actor, Permission.NETWORK_REQUEST);
    const rows = await this.prisma.carrierFollow.findMany({
      where: { carrierCompanyId: actor.companyId! },
      include: { shipperCompany: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => ({
      id: r.id,
      shipperCompanyId: r.shipperCompanyId,
      shipperCompanyName: r.shipperCompany.name,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
