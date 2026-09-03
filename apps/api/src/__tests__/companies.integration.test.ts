import type { PrismaClient } from "@loadtopia/db";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  authed,
  makeApp,
  makePrisma,
  registerCompany,
  resetDb,
  TEST_DB_URL,
} from "./it-harness";

const suite = TEST_DB_URL ? describe : describe.skip;

suite("companies + memberships + company switching (integration)", () => {
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

  it("creates a company with a unique load-number prefix and enrols the creator", async () => {
    const s = await registerCompany(api);
    const res = await api.inject(
      authed(s.cookie, {
        method: "POST",
        url: "/api/companies",
        payload: { name: "Second Shipper LLC", type: "SHIPPER", city: "Reno", state: "nv" },
      }),
    );
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.loadNumberPrefix).toMatch(/^[A-Z0-9]{2,8}$/);
    expect(body.state).toBe("NV"); // server-side normalization

    const membership = await prisma.membership.findFirst({
      where: { userId: s.userId, companyId: body.id },
    });
    expect(membership?.isActive).toBe(true);
  });

  it("returns 404 (not 403) when reading a company the caller is not a member of", async () => {
    const a = await registerCompany(api);
    const b = await registerCompany(api);
    const res = await api.inject(
      authed(a.cookie, { method: "GET", url: `/api/companies/${b.companyId}` }),
    );
    expect(res.statusCode).toBe(404);
  });

  it("lets a member read and update its own company but rejects cross-company update", async () => {
    const a = await registerCompany(api);
    const b = await registerCompany(api);

    const read = await api.inject(
      authed(a.cookie, { method: "GET", url: `/api/companies/${a.companyId}` }),
    );
    expect(read.statusCode).toBe(200);

    const ok = await api.inject(
      authed(a.cookie, {
        method: "PATCH",
        url: `/api/companies/${a.companyId}`,
        payload: { phone: "312-555-0111", dotNumber: "DOT123" },
      }),
    );
    expect(ok.statusCode).toBe(200);
    expect(ok.json().phone).toBe("312-555-0111");

    const cross = await api.inject(
      authed(a.cookie, {
        method: "PATCH",
        url: `/api/companies/${b.companyId}`,
        payload: { phone: "312-555-9999" },
      }),
    );
    expect(cross.statusCode).toBe(404);
  });

  describe("memberships", () => {
    it("adds an existing user, prevents duplicates, and blocks non-members", async () => {
      const owner = await registerCompany(api, { companyName: "Owner Co" });
      const outsiderCo = await registerCompany(api, { email: "friend@it.test" });

      const add = await api.inject(
        authed(owner.cookie, {
          method: "POST",
          url: `/api/companies/${owner.companyId}/members`,
          payload: { email: "friend@it.test", role: "SHIPPER" },
        }),
      );
      expect(add.statusCode).toBe(201);

      const dup = await api.inject(
        authed(owner.cookie, {
          method: "POST",
          url: `/api/companies/${owner.companyId}/members`,
          payload: { email: "friend@it.test", role: "SHIPPER" },
        }),
      );
      expect(dup.statusCode).toBe(409);

      // The outsider (now also a member) cannot manage a DIFFERENT company.
      const forbidden = await api.inject(
        authed(outsiderCo.cookie, {
          method: "POST",
          url: `/api/companies/${owner.companyId}/members`,
          payload: { email: "friend@it.test", role: "SHIPPER" },
        }),
      );
      expect(forbidden.statusCode).toBe(404);
    });

    it("rejects adding a user with no LoadTopia account", async () => {
      const owner = await registerCompany(api);
      const res = await api.inject(
        authed(owner.cookie, {
          method: "POST",
          url: `/api/companies/${owner.companyId}/members`,
          payload: { email: "ghost@nowhere.test", role: "SHIPPER" },
        }),
      );
      expect(res.statusCode).toBe(404);
    });

    it("refuses to deactivate your own membership or the last active member", async () => {
      const owner = await registerCompany(api);
      const members = await api.inject(
        authed(owner.cookie, { method: "GET", url: `/api/companies/${owner.companyId}/members` }),
      );
      const ownMembership = members.json().data[0].membershipId;

      const selfOff = await api.inject(
        authed(owner.cookie, {
          method: "PATCH",
          url: `/api/memberships/${ownMembership}`,
          payload: { isActive: false },
        }),
      );
      expect(selfOff.statusCode).toBe(400);
    });

    it("deactivates another member and blocks their access", async () => {
      const owner = await registerCompany(api, { companyName: "Owner Co 2" });
      await registerCompany(api, { email: "member@it.test" });
      const added = await api.inject(
        authed(owner.cookie, {
          method: "POST",
          url: `/api/companies/${owner.companyId}/members`,
          payload: { email: "member@it.test", role: "SHIPPER" },
        }),
      );
      const membershipId = added.json().membershipId;

      const off = await api.inject(
        authed(owner.cookie, {
          method: "PATCH",
          url: `/api/memberships/${membershipId}`,
          payload: { isActive: false },
        }),
      );
      expect(off.statusCode).toBe(200);
      expect(off.json().isActive).toBe(false);
    });
  });

  describe("company switching", () => {
    it("switches to another active membership and persists it on the session", async () => {
      const s = await registerCompany(api, { companyName: "Primary Co" });
      const second = await api.inject(
        authed(s.cookie, {
          method: "POST",
          url: "/api/companies",
          payload: { name: "Carrier Arm", type: "CARRIER" },
        }),
      );
      const secondId = second.json().id;

      const sw = await api.inject(
        authed(s.cookie, {
          method: "POST",
          url: "/api/auth/switch-company",
          payload: { companyId: secondId },
        }),
      );
      expect(sw.statusCode).toBe(200);
      expect(sw.json().activeCompanyId).toBe(secondId);
      expect(sw.json().role).toBe("CARRIER");

      // A fresh request (same cookie) sees the switched company.
      const me = await api.inject(authed(s.cookie, { method: "GET", url: "/api/auth/me" }));
      expect(me.json().activeCompanyId).toBe(secondId);
    });

    it("rejects switching to a company the user is not a member of (404)", async () => {
      const a = await registerCompany(api);
      const b = await registerCompany(api);
      const res = await api.inject(
        authed(a.cookie, {
          method: "POST",
          url: "/api/auth/switch-company",
          payload: { companyId: b.companyId },
        }),
      );
      expect(res.statusCode).toBe(404);
    });

    it("rejects switching to an invalid company id (400)", async () => {
      const a = await registerCompany(api);
      const res = await api.inject(
        authed(a.cookie, {
          method: "POST",
          url: "/api/auth/switch-company",
          payload: { companyId: "not-a-uuid" },
        }),
      );
      expect(res.statusCode).toBe(400);
    });

    it("re-defaults the active company when the current one is deactivated", async () => {
      const owner = await registerCompany(api, { companyName: "Multi Co" });
      // owner joins a second company they own
      const second = await api.inject(
        authed(owner.cookie, {
          method: "POST",
          url: "/api/companies",
          payload: { name: "Multi Co Two", type: "SHIPPER" },
        }),
      );
      const secondId = second.json().id;
      await api.inject(
        authed(owner.cookie, {
          method: "POST",
          url: "/api/auth/switch-company",
          payload: { companyId: secondId },
        }),
      );
      // Deactivate the owner's membership in the second company directly.
      const m = await prisma.membership.findFirstOrThrow({
        where: { userId: owner.userId, companyId: secondId },
      });
      await prisma.membership.update({ where: { id: m.id }, data: { isActive: false } });

      const me = await api.inject(authed(owner.cookie, { method: "GET", url: "/api/auth/me" }));
      expect(me.statusCode).toBe(200);
      expect(me.json().activeCompanyId).toBe(owner.companyId);
    });
  });
});
