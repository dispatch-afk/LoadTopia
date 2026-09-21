import type { Prisma, PrismaClient } from "@loadtopia/db";
import {
  assertLoadFacilityScope as assertLoadFacilityScopeDomain,
  type FacilityScopedLoadAccessView,
} from "@loadtopia/domain";
import type { AuthenticatedActor } from "@loadtopia/shared";

/** Either the top-level client or an open transaction — both expose the same
 *  `membershipFacilityScope` model delegate this module needs. */
type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Facility scope (Milestone 4 Phase 7) — the DB-touching half of the check.
 * The domain layer decides the RULE (an ADDITIONAL "where" restriction on
 * top of canReadLoad/canModifyLoad's "who" check); this resolves the ACTIVE
 * membership's current scope rows and applies it. Scope rows are fetched
 * fresh from the database on every call — never cached on the actor/session
 * — so a scope change, a scope clear, or a company switch is honored
 * immediately (Phase 7 §22/§29).
 *
 * A no-op query (zero facility-scope rows fetched) for any actor who is not
 * a shipper-company member acting on their own company's load — admin,
 * carrier, or an unrelated company — since {@link assertLoadFacilityScopeDomain}
 * only constrains that one case.
 */
export async function enforceLoadFacilityScope(
  prisma: Db,
  actor: AuthenticatedActor,
  load: FacilityScopedLoadAccessView,
): Promise<void> {
  const scopeRows =
    actor.companyId === load.shipperCompanyId && actor.membershipId !== null
      ? await prisma.membershipFacilityScope.findMany({
          where: { membershipId: actor.membershipId },
          select: { locationId: true },
        })
      : [];
  assertLoadFacilityScopeDomain(actor, load, scopeRows);
}

/** The Prisma predicate equivalent of facility scope, for LIST queries — pushed
 *  into the database rather than fetched-then-filtered in memory (§17). Resolves
 *  the active membership's scope once per call; `undefined` (no predicate) for
 *  a company-wide membership, so the caller's existing `where` is untouched —
 *  callers combine it via `AND: [existingClause, facilityClause]` since a
 *  Prisma `where` object may only carry one top-level `OR` key. */
export async function loadFacilityScopeWhere(
  prisma: PrismaClient,
  actor: AuthenticatedActor,
): Promise<Prisma.LoadWhereInput | undefined> {
  if (actor.membershipId === null) return undefined;
  const scopeRows = await prisma.membershipFacilityScope.findMany({
    where: { membershipId: actor.membershipId },
    select: { locationId: true },
  });
  if (scopeRows.length === 0) return undefined;
  const locationIds = scopeRows.map((r) => r.locationId);
  return {
    OR: [{ originLocationId: { in: locationIds } }, { destinationLocationId: { in: locationIds } }],
  };
}
