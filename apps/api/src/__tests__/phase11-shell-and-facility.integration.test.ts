import type { PrismaClient } from "@loadtopia/db";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addNonPrimaryMember,
  authed,
  createLocation,
  makeApp,
  makePrisma,
  registerCompany,
  resetDb,
  TEST_DB_URL,
  type Session,
} from "./it-harness";

const suite = TEST_DB_URL ? describe : describe.skip;

suite("M4 Phase 11 — role-aware shell + facility-scope admin (integration)", () => {
  let prisma: PrismaClient;
  let api: FastifyInstance;

  beforeAll(async () => {
    prisma = makePrisma();
    await prisma.$connect();
  });
  afterAll(async () => {
    await resetDb(prisma);
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetDb(prisma);
    api = await makeApp(prisma);
  });
  afterEach(async () => {
    await api?.close();
  });

  async function ownMembershipId(userId: string, companyId: string): Promise<string> {
    return prisma.membership.findFirstOrThrow({ where: { userId, companyId } }).then((m) => m.id);
  }

  async function otherMembershipId(companyId: string, notUserId: string): Promise<string> {
    return prisma.membership
      .findFirstOrThrow({ where: { companyId, userId: { not: notUserId } } })
      .then((m) => m.id);
  }

  /** A second, NON-PRIMARY member of `primary`'s company, added under a
   *  fresh throwaway account (addNonPrimaryMember requires the target email
   *  to already have a LoadTopia account — mirrors network.integration.test.ts's
   *  `ordinaryMember` helper). Returns the new member's session cookie. */
  async function addMember(primary: Session, email: string): Promise<string> {
    const throwaway = await registerCompany(api, { email, companyName: `throwaway-${email}` });
    return addNonPrimaryMember(api, primary.cookie, primary.companyId, {
      email: throwaway.email,
      role: "SHIPPER",
    });
  }

  // ── /auth/me facilityScoped ────────────────────────────────────────

  describe("GET /auth/me facilityScoped", () => {
    it("is false for a company-wide (zero-row) active membership", async () => {
      const s = await registerCompany(api, { companyName: "Facility Co A" });
      const res = await api.inject(authed(s.cookie, { method: "GET", url: "/api/auth/me" }));
      expect(res.statusCode).toBe(200);
      expect(res.json().facilityScoped).toBe(false);
    });

    it("is true once the active membership has one or more facility-scope rows", async () => {
      const primary = await registerCompany(api, { companyName: "Facility Co B" });
      const memberCookie = await addMember(primary, "scoped-member@it.test");
      const loc = await createLocation(api, primary.cookie, { city: "Austin", state: "TX" });
      const memberId = await otherMembershipId(primary.companyId, primary.userId);

      const set = await api.inject(
        authed(primary.cookie, {
          method: "PUT",
          url: `/api/memberships/${memberId}/facility-scope`,
          payload: { locationIds: [loc] },
        }),
      );
      expect(set.statusCode).toBe(200);

      const me = await api.inject(authed(memberCookie, { method: "GET", url: "/api/auth/me" }));
      expect(me.json().facilityScoped).toBe(true);

      // The primary who set the scope is never self-scoped — still company-wide.
      const mePrimary = await api.inject(authed(primary.cookie, { method: "GET", url: "/api/auth/me" }));
      expect(mePrimary.json().facilityScoped).toBe(false);
    });

    it("reflects the ACTIVE membership after switching company, not a stale one", async () => {
      const companyA = await registerCompany(api, { companyName: "Dual Co A" });
      const sharedCookie = await addMember(companyA, "dual-member@it.test");
      const locA = await createLocation(api, companyA.cookie, { city: "Denver", state: "CO" });
      const memberInA = await otherMembershipId(companyA.companyId, companyA.userId);
      await api.inject(
        authed(companyA.cookie, {
          method: "PUT",
          url: `/api/memberships/${memberInA}/facility-scope`,
          payload: { locationIds: [locA] },
        }),
      );

      const companyB = await registerCompany(api, { companyName: "Dual Co B" });
      await api.inject(
        authed(companyB.cookie, {
          method: "POST",
          url: `/api/companies/${companyB.companyId}/members`,
          payload: { email: "dual-member@it.test", role: "SHIPPER" },
        }),
      );

      const meA = await api.inject(authed(sharedCookie, { method: "GET", url: "/api/auth/me" }));
      expect(meA.json().activeCompanyId).toBe(companyA.companyId);
      expect(meA.json().facilityScoped).toBe(true);

      await api.inject(
        authed(sharedCookie, {
          method: "POST",
          url: "/api/auth/switch-company",
          payload: { companyId: companyB.companyId },
        }),
      );
      const meB = await api.inject(authed(sharedCookie, { method: "GET", url: "/api/auth/me" }));
      expect(meB.json().activeCompanyId).toBe(companyB.companyId);
      expect(meB.json().facilityScoped).toBe(false);
    });
  });

  // ── Team freight-access read model ─────────────────────────────────

  describe("GET /companies/:id/members freight access", () => {
    it("reports company-wide by default and an assigned-facility count after scoping, via one bounded query", async () => {
      const primary = await registerCompany(api, { companyName: "Team Co" });
      await addMember(primary, "teammate@it.test");
      const memberId = await otherMembershipId(primary.companyId, primary.userId);
      const loc = await createLocation(api, primary.cookie, { city: "Reno", state: "NV" });

      const before = await api.inject(
        authed(primary.cookie, { method: "GET", url: `/api/companies/${primary.companyId}/members` }),
      );
      const beforeMember = before
        .json()
        .data.find((m: { membershipId: string }) => m.membershipId === memberId);
      expect(beforeMember.freightAccess).toEqual({ companyWide: true, facilityCount: 0 });

      await api.inject(
        authed(primary.cookie, {
          method: "PUT",
          url: `/api/memberships/${memberId}/facility-scope`,
          payload: { locationIds: [loc] },
        }),
      );

      const after = await api.inject(
        authed(primary.cookie, { method: "GET", url: `/api/companies/${primary.companyId}/members` }),
      );
      const afterMember = after
        .json()
        .data.find((m: { membershipId: string }) => m.membershipId === memberId);
      expect(afterMember.freightAccess).toEqual({ companyWide: false, facilityCount: 1 });

      // The primary's own row is unaffected and still company-wide.
      const primaryMember = after
        .json()
        .data.find((m: { membershipId: string }) => m.membershipId !== memberId);
      expect(primaryMember.freightAccess).toEqual({ companyWide: true, facilityCount: 0 });
    });
  });

  // ── Locked guardrails ───────────────────────────────────────────────

  describe("Facility-scope self-management guard", () => {
    it("rejects a membership changing its own facility scope, even the primary", async () => {
      const s = await registerCompany(api, { companyName: "Self Guard Co" });
      const own = await ownMembershipId(s.userId, s.companyId);

      const res = await api.inject(
        authed(s.cookie, {
          method: "PUT",
          url: `/api/memberships/${own}/facility-scope`,
          payload: { locationIds: [] },
        }),
      );
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toMatch(/own facility scope/i);

      const rows = await prisma.membershipFacilityScope.findMany({ where: { membershipId: own } });
      expect(rows).toHaveLength(0);
    });
  });

  describe("Facility-scope inactive-location guard", () => {
    it("rejects assigning an inactive location, and persists nothing", async () => {
      const primary = await registerCompany(api, { companyName: "Inactive Loc Co" });
      await addMember(primary, "member-inactive-loc@it.test");
      const memberId = await otherMembershipId(primary.companyId, primary.userId);
      const loc = await createLocation(api, primary.cookie, { city: "Boise", state: "ID" });

      const deactivate = await api.inject(
        authed(primary.cookie, { method: "DELETE", url: `/api/locations/${loc}` }),
      );
      expect(deactivate.statusCode).toBe(200);
      expect(deactivate.json().isActive).toBe(false);

      const res = await api.inject(
        authed(primary.cookie, {
          method: "PUT",
          url: `/api/memberships/${memberId}/facility-scope`,
          payload: { locationIds: [loc] },
        }),
      );
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toMatch(/inactive location/i);

      const rows = await prisma.membershipFacilityScope.findMany({ where: { membershipId: memberId } });
      expect(rows).toHaveLength(0);
    });
  });

  describe("Location deactivation vs. facility scope", () => {
    it("blocks deactivating a location referenced by a facility-scope assignment, then allows it once the scope is cleared", async () => {
      const primary = await registerCompany(api, { companyName: "Scoped Loc Co" });
      await addMember(primary, "member-scoped-loc@it.test");
      const memberId = await otherMembershipId(primary.companyId, primary.userId);
      const loc = await createLocation(api, primary.cookie, { city: "Tulsa", state: "OK" });

      const setScope = await api.inject(
        authed(primary.cookie, {
          method: "PUT",
          url: `/api/memberships/${memberId}/facility-scope`,
          payload: { locationIds: [loc] },
        }),
      );
      expect(setScope.statusCode).toBe(200);

      const blocked = await api.inject(
        authed(primary.cookie, { method: "DELETE", url: `/api/locations/${loc}` }),
      );
      expect(blocked.statusCode).toBe(409);

      const stillActive = await prisma.location.findUniqueOrThrow({ where: { id: loc } });
      expect(stillActive.isActive).toBe(true);

      const clearScope = await api.inject(
        authed(primary.cookie, {
          method: "PUT",
          url: `/api/memberships/${memberId}/facility-scope`,
          payload: { locationIds: [] },
        }),
      );
      expect(clearScope.statusCode).toBe(200);

      const allowed = await api.inject(
        authed(primary.cookie, { method: "DELETE", url: `/api/locations/${loc}` }),
      );
      expect(allowed.statusCode).toBe(200);
      expect(allowed.json().isActive).toBe(false);
    });
  });
});
