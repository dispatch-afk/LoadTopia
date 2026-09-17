import type { PrismaClient } from "@loadtopia/db";
import { assertCompanyPrimaryAuthority, assertCompanyScope, assertPermission, Permission } from "@loadtopia/domain";
import type { AuthenticatedActor, FacilityScopeView } from "@loadtopia/shared";
import { badRequest, notFound } from "../../lib/errors";

/**
 * Facility scope (Milestone 4 Phase 2): an ADDITIONAL restriction layered on
 * top of role/permission — it never replaces RBAC, only narrows WHERE an
 * already-permitted action may be taken. No rows = company-wide access (the
 * default for a single-location company); one or more rows = restricted to
 * those Locations. Only company-primary/admin authority may manage another
 * membership's scope.
 */
export class FacilityScopeService {
  constructor(private readonly prisma: PrismaClient) {}

  async get(actor: AuthenticatedActor, membershipId: string): Promise<FacilityScopeView> {
    assertPermission(actor, Permission.MEMBERSHIP_READ);
    const membership = await this.prisma.membership.findUnique({ where: { id: membershipId } });
    if (!membership) throw notFound("Membership not found");
    assertCompanyScope(actor, membership.companyId);

    const rows = await this.prisma.membershipFacilityScope.findMany({ where: { membershipId } });
    return {
      membershipId,
      locationIds: rows.map((r) => r.locationId),
      companyWide: rows.length === 0,
    };
  }

  /** Full-replace semantics: the membership's scope becomes EXACTLY the
   *  given location list. Both the membership and every location must
   *  belong to the SAME company — the database cannot express that
   *  cross-table invariant via FK alone, so it is verified here, inside the
   *  same transaction as the write.
   *
   *  Milestone 4 Phase 11 guardrails:
   *   - a membership may never edit its OWN facility scope (access control
   *     boundary — a restricted user must not be able to restore their own
   *     company-wide access), mirroring the existing "cannot deactivate your
   *     own membership" rule in CompaniesService;
   *   - every referenced location must be ACTIVE — an archived location can
   *     never be (re)assigned as a facility. */
  async set(
    actor: AuthenticatedActor,
    membershipId: string,
    locationIds: string[],
  ): Promise<FacilityScopeView> {
    assertPermission(actor, Permission.FACILITY_SCOPE_MANAGE);
    assertCompanyPrimaryAuthority(actor);

    const membership = await this.prisma.membership.findUnique({ where: { id: membershipId } });
    if (!membership) throw notFound("Membership not found");
    assertCompanyScope(actor, membership.companyId);

    if (membership.userId === actor.userId) {
      throw badRequest("You cannot change your own facility scope");
    }

    const uniqueIds = Array.from(new Set(locationIds));

    return this.prisma.$transaction(async (tx) => {
      if (uniqueIds.length > 0) {
        const locations = await tx.location.findMany({
          where: { id: { in: uniqueIds } },
          select: { id: true, companyId: true, isActive: true },
        });
        if (locations.length !== uniqueIds.length) {
          throw notFound("One or more locations were not found");
        }
        const foreign = locations.find((l) => l.companyId !== membership.companyId);
        if (foreign) {
          throw badRequest(
            "A facility scope cannot reference a location belonging to another company",
          );
        }
        const inactive = locations.find((l) => !l.isActive);
        if (inactive) {
          throw badRequest("A facility scope cannot reference an inactive location");
        }
      }

      await tx.membershipFacilityScope.deleteMany({ where: { membershipId } });
      if (uniqueIds.length > 0) {
        await tx.membershipFacilityScope.createMany({
          data: uniqueIds.map((locationId) => ({ membershipId, locationId })),
        });
      }

      return { membershipId, locationIds: uniqueIds, companyWide: uniqueIds.length === 0 };
    });
  }
}
