import type { PrismaClient } from "@loadtopia/db";
import {
  assertCompanyPrimaryAuthority,
  assertPermission,
  canonicalizeCompanyPair,
  Permission,
} from "@loadtopia/domain";
import {
  type AuthenticatedActor,
  type CarrierPreferenceType,
  type CarrierPreferenceView,
  ConnectionStatus,
} from "@loadtopia/shared";
import { badRequest, conflict, notFound } from "../../lib/errors";

/**
 * A shipper company's PRIVATE preference on a carrier — never a rating,
 * never exposed to the carrier. Only company-primary/admin authority may set
 * or clear it; any active member may read their own company's preferences.
 * Requires an ACCEPTED Connection to the carrier (the locked product rule —
 * see the M4 Phase 2 spec §E).
 */
export class PreferencesService {
  constructor(private readonly prisma: PrismaClient) {}

  private async assertConnected(shipperCompanyId: string, carrierCompanyId: string): Promise<void> {
    const pair = canonicalizeCompanyPair(shipperCompanyId, carrierCompanyId);
    const connection = await this.prisma.companyConnection.findUnique({
      where: { companyAId_companyBId: { companyAId: pair.companyAId, companyBId: pair.companyBId } },
    });
    if (!connection || connection.status !== ConnectionStatus.ACCEPTED) {
      throw conflict("A preference can only be set for a carrier you are connected to");
    }
  }

  async set(
    actor: AuthenticatedActor,
    carrierCompanyId: string,
    preference: CarrierPreferenceType,
  ): Promise<CarrierPreferenceView> {
    assertPermission(actor, Permission.NETWORK_MANAGE);
    assertCompanyPrimaryAuthority(actor);
    const myCompanyId = actor.companyId!;
    if (myCompanyId === carrierCompanyId) throw badRequest("A company cannot set a preference on itself");

    const carrier = await this.prisma.company.findUnique({ where: { id: carrierCompanyId } });
    if (!carrier) throw notFound("Company not found");

    await this.assertConnected(myCompanyId, carrierCompanyId);

    const row = await this.prisma.carrierPreference.upsert({
      where: { shipperCompanyId_carrierCompanyId: { shipperCompanyId: myCompanyId, carrierCompanyId } },
      create: { shipperCompanyId: myCompanyId, carrierCompanyId, preference, setByUserId: actor.userId },
      update: { preference, setByUserId: actor.userId },
    });
    return {
      carrierCompanyId,
      carrierCompanyName: carrier.name,
      preference: row.preference,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async clear(actor: AuthenticatedActor, carrierCompanyId: string): Promise<void> {
    assertPermission(actor, Permission.NETWORK_MANAGE);
    assertCompanyPrimaryAuthority(actor);
    await this.prisma.carrierPreference.deleteMany({
      where: { shipperCompanyId: actor.companyId!, carrierCompanyId },
    });
  }

  async get(actor: AuthenticatedActor, carrierCompanyId: string): Promise<CarrierPreferenceView | null> {
    assertPermission(actor, Permission.NETWORK_REQUEST);
    const row = await this.prisma.carrierPreference.findUnique({
      where: {
        shipperCompanyId_carrierCompanyId: { shipperCompanyId: actor.companyId!, carrierCompanyId },
      },
      include: { carrierCompany: { select: { name: true } } },
    });
    if (!row) return null;
    return {
      carrierCompanyId,
      carrierCompanyName: row.carrierCompany.name,
      preference: row.preference,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async list(actor: AuthenticatedActor): Promise<CarrierPreferenceView[]> {
    assertPermission(actor, Permission.NETWORK_REQUEST);
    const rows = await this.prisma.carrierPreference.findMany({
      where: { shipperCompanyId: actor.companyId! },
      include: { carrierCompany: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map((r) => ({
      carrierCompanyId: r.carrierCompanyId,
      carrierCompanyName: r.carrierCompany.name,
      preference: r.preference,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }
}
