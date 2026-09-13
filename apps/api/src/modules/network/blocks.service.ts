import type { Prisma, PrismaClient } from "@loadtopia/db";
import {
  ACTIVE_FREIGHT_STATUSES,
  assertCompanyPrimaryAuthority,
  assertPermission,
  initialBlockStatus,
  isBlockInForce,
  Permission,
} from "@loadtopia/domain";
import { type AuthenticatedActor, type CompanyBlockView, CompanyBlockStatus } from "@loadtopia/shared";
import { badRequest, notFound } from "../../lib/errors";

type Tx = Prisma.TransactionClient;

function toView(
  row: { id: string; status: CompanyBlockStatus; createdAt: Date; effectiveAt: Date | null; removedAt: Date | null },
  blockedCompanyId: string,
  blockedCompanyName: string,
): CompanyBlockView {
  return {
    id: row.id,
    blockedCompanyId,
    blockedCompanyName,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    effectiveAt: row.effectiveAt?.toISOString() ?? null,
    removedAt: row.removedAt?.toISOString() ?? null,
  };
}

/**
 * Block is PRIVATE to the blocking company — the blocked company is never
 * notified and never sees this state through any endpoint. Freight
 * continuity outranks block immediacy: if active commercial/operational
 * freight exists between the pair (see {@link ACTIVE_FREIGHT_STATUSES}), the
 * new block episode starts PENDING_ON_COMPLETION rather than ACTIVE, so
 * every operational surface (status updates, check-ins, documents, POD, Rate
 * Confirmation, completion) keeps working uninterrupted for that freight.
 * Phase 2 establishes this truth and the query behind it; it does NOT yet
 * wire any marketplace/visibility surface to read it (later phase).
 */
export class BlocksService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Whether ACTIVE freight (per the locked M4 Phase 2 rule — award through
   *  DELIVERED) currently exists between the two companies, in EITHER
   *  shipper/carrier role. */
  async hasActiveFreightBetween(
    tx: Tx | PrismaClient,
    companyId1: string,
    companyId2: string,
  ): Promise<boolean> {
    const load = await tx.load.findFirst({
      where: {
        status: { in: [...ACTIVE_FREIGHT_STATUSES] },
        OR: [
          { shipperCompanyId: companyId1, carrierCompanyId: companyId2 },
          { shipperCompanyId: companyId2, carrierCompanyId: companyId1 },
        ],
      },
      select: { id: true },
    });
    return load !== null;
  }

  async block(actor: AuthenticatedActor, blockedCompanyId: string): Promise<CompanyBlockView> {
    assertPermission(actor, Permission.NETWORK_MANAGE);
    assertCompanyPrimaryAuthority(actor);
    const myCompanyId = actor.companyId!;
    if (myCompanyId === blockedCompanyId) throw badRequest("A company cannot block itself");

    const blocked = await this.prisma.company.findUnique({ where: { id: blockedCompanyId } });
    if (!blocked) throw notFound("Company not found");

    return this.prisma.$transaction(async (tx) => {
      const hasActiveFreight = await this.hasActiveFreightBetween(tx, myCompanyId, blockedCompanyId);
      const status = initialBlockStatus(hasActiveFreight);
      const now = new Date();

      try {
        const created = await tx.companyBlock.create({
          data: {
            blockingCompanyId: myCompanyId,
            blockedCompanyId,
            status,
            createdByUserId: actor.userId,
            effectiveAt: status === CompanyBlockStatus.ACTIVE ? now : null,
          },
        });
        return toView(created, blockedCompanyId, blocked.name);
      } catch (err) {
        if ((err as { code?: string }).code === "P2002") {
          throw badRequest("This company is already blocked");
        }
        throw err;
      }
    });
  }

  async unblock(actor: AuthenticatedActor, blockedCompanyId: string): Promise<CompanyBlockView> {
    assertPermission(actor, Permission.NETWORK_MANAGE);
    assertCompanyPrimaryAuthority(actor);
    const myCompanyId = actor.companyId!;

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.companyBlock.findFirst({
        where: {
          blockingCompanyId: myCompanyId,
          blockedCompanyId,
          status: { in: [CompanyBlockStatus.ACTIVE, CompanyBlockStatus.PENDING_ON_COMPLETION] },
        },
      });
      if (!existing) throw notFound("No active block found for this company");

      await tx.$executeRaw`SELECT 1 FROM company_blocks WHERE id = ${existing.id}::uuid FOR UPDATE`;
      const fresh = await tx.companyBlock.findUniqueOrThrow({ where: { id: existing.id } });
      if (!isBlockInForce(fresh.status)) throw notFound("No active block found for this company");

      const updated = await tx.companyBlock.update({
        where: { id: existing.id },
        data: { status: CompanyBlockStatus.INACTIVE, removedByUserId: actor.userId, removedAt: new Date() },
      });
      const blocked = await tx.company.findUniqueOrThrow({ where: { id: blockedCompanyId } });
      return toView(updated, blockedCompanyId, blocked.name);
    });
  }

  /**
   * Re-evaluate a PENDING_ON_COMPLETION block: if the active freight that was
   * keeping it pending has ended (completed/cancelled), flip it to ACTIVE.
   * Not called from anywhere yet in Phase 2 (no operational endpoint is
   * wired to invoke it — that belongs to a later phase); exposed and tested
   * here to prove the continuity behavior is structurally correct and ready
   * to be wired up without any further schema/domain change.
   */
  async recheckContinuity(actor: AuthenticatedActor, blockId: string): Promise<CompanyBlockView> {
    assertPermission(actor, Permission.NETWORK_MANAGE);
    assertCompanyPrimaryAuthority(actor);
    const myCompanyId = actor.companyId!;

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.companyBlock.findUnique({ where: { id: blockId } });
      if (!existing || existing.blockingCompanyId !== myCompanyId) throw notFound("Block not found");
      if (existing.status !== CompanyBlockStatus.PENDING_ON_COMPLETION) {
        const blocked = await tx.company.findUniqueOrThrow({ where: { id: existing.blockedCompanyId } });
        return toView(existing, existing.blockedCompanyId, blocked.name);
      }

      await tx.$executeRaw`SELECT 1 FROM company_blocks WHERE id = ${existing.id}::uuid FOR UPDATE`;
      const stillActive = await this.hasActiveFreightBetween(tx, myCompanyId, existing.blockedCompanyId);
      const blocked = await tx.company.findUniqueOrThrow({ where: { id: existing.blockedCompanyId } });

      if (stillActive) return toView(existing, existing.blockedCompanyId, blocked.name);

      const now = new Date();
      const updated = await tx.companyBlock.update({
        where: { id: blockId },
        data: { status: CompanyBlockStatus.ACTIVE, effectiveAt: now },
      });
      return toView(updated, existing.blockedCompanyId, blocked.name);
    });
  }

  async list(actor: AuthenticatedActor): Promise<CompanyBlockView[]> {
    assertPermission(actor, Permission.NETWORK_REQUEST);
    const rows = await this.prisma.companyBlock.findMany({
      where: { blockingCompanyId: actor.companyId! },
      include: { blockedCompany: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => toView(r, r.blockedCompanyId, r.blockedCompany.name));
  }
}
