import type { PrismaClient } from "@loadtopia/db";
import { assertCanReadLoad, assertCompanyScope } from "@loadtopia/domain";
import type { AuthenticatedActor } from "@loadtopia/shared";
import { notFound } from "./errors";

/**
 * Verify the caller may act on a company-owned resource BEFORE its request body
 * is validated (API SECURITY ordering: resolve scope → then validate data).
 * Cross-company access raises a 404 so existence cannot be probed by UUID.
 * Services re-assert scope as defence in depth.
 */
export async function assertResourceScope(
  prisma: PrismaClient,
  actor: AuthenticatedActor,
  kind: "company" | "location" | "equipment" | "load" | "membership",
  id: string,
): Promise<void> {
  switch (kind) {
    case "company": {
      const row = await prisma.company.findUnique({ where: { id }, select: { id: true } });
      if (!row) throw notFound("Company not found");
      assertCompanyScope(actor, row.id);
      return;
    }
    case "location": {
      const row = await prisma.location.findUnique({ where: { id }, select: { companyId: true } });
      if (!row) throw notFound("Location not found");
      assertCompanyScope(actor, row.companyId);
      return;
    }
    case "equipment": {
      const row = await prisma.equipment.findUnique({ where: { id }, select: { companyId: true } });
      if (!row) throw notFound("Equipment not found");
      assertCompanyScope(actor, row.companyId);
      return;
    }
    case "membership": {
      const row = await prisma.membership.findUnique({ where: { id }, select: { companyId: true } });
      if (!row) throw notFound("Membership not found");
      assertCompanyScope(actor, row.companyId);
      return;
    }
    case "load": {
      const row = await prisma.load.findUnique({
        where: { id },
        select: { shipperCompanyId: true, carrierCompanyId: true },
      });
      if (!row) throw notFound("Load not found");
      assertCanReadLoad(actor, row);
      return;
    }
  }
}
