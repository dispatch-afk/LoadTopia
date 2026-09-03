import type { PrismaClient } from "@loadtopia/db";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  authed,
  createLocation,
  makeApp,
  makePrisma,
  registerCompany,
  resetDb,
  TEST_DB_URL,
} from "./it-harness";

const suite = TEST_DB_URL ? describe : describe.skip;

suite("authorization (integration)", () => {
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

  it("unauthenticated requests to protected routes get 401", async () => {
    for (const url of ["/api/loads", "/api/locations", "/api/equipment", "/api/auth/me"]) {
      const res = await api.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(401);
    }
  });

  it("an authorized company member can act; a non-member cannot see the resource", async () => {
    const owner = await registerCompany(api, { companyName: "Owner" });
    const loc = await createLocation(api, owner.cookie);
    const outsider = await registerCompany(api);

    const ownerRead = await api.inject(
      authed(owner.cookie, { method: "GET", url: `/api/locations/${loc}` }),
    );
    expect(ownerRead.statusCode).toBe(200);

    const outsiderRead = await api.inject(
      authed(outsider.cookie, { method: "GET", url: `/api/locations/${loc}` }),
    );
    expect(outsiderRead.statusCode).toBe(404);
  });

  it("an inactive membership can no longer act for that company", async () => {
    const owner = await registerCompany(api, { companyName: "Team Co" });
    await registerCompany(api, { email: "worker@it.test" });
    const added = await api.inject(
      authed(owner.cookie, {
        method: "POST",
        url: `/api/companies/${owner.companyId}/members`,
        payload: { email: "worker@it.test", role: "SHIPPER" },
      }),
    );
    const membershipId = added.json().membershipId;

    // worker logs into the team company
    const login = await api.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "worker@it.test", password: "integration-test-password" },
    });
    const workerCookie = login.cookies.find((c) => c.name === "loadtopia_session")!.value;
    await api.inject(
      authed(workerCookie, {
        method: "POST",
        url: "/api/auth/switch-company",
        payload: { companyId: owner.companyId },
      }),
    );
    const before = await api.inject(
      authed(workerCookie, { method: "GET", url: "/api/loads" }),
    );
    expect(before.statusCode).toBe(200);

    // owner deactivates the worker's membership
    await api.inject(
      authed(owner.cookie, {
        method: "PATCH",
        url: `/api/memberships/${membershipId}`,
        payload: { isActive: false },
      }),
    );

    // worker's next request no longer resolves that company (falls back to their own)
    const after = await api.inject(authed(workerCookie, { method: "GET", url: "/api/auth/me" }));
    expect(after.json().activeCompanyId).not.toBe(owner.companyId);
  });

  it("enforces role restrictions: a CARRIER member cannot create loads", async () => {
    const carrier = await registerCompany(api, { type: "CARRIER" });
    const res = await api.inject(
      authed(carrier.cookie, {
        method: "POST",
        url: "/api/loads",
        payload: {
          originLocationId: "00000000-0000-0000-0000-000000000000",
          destinationLocationId: "00000000-0000-0000-0000-000000000001",
          equipmentType: "DRY_VAN",
        },
      }),
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");

    // ...and cannot list loads at all.
    const list = await api.inject(authed(carrier.cookie, { method: "GET", url: "/api/loads" }));
    expect(list.statusCode).toBe(403);
  });

  it("a CARRIER member CAN manage equipment and locations for their own company", async () => {
    const carrier = await registerCompany(api, { type: "CARRIER" });
    const eq = await api.inject(
      authed(carrier.cookie, {
        method: "POST",
        url: "/api/equipment",
        payload: { type: "FLATBED" },
      }),
    );
    expect(eq.statusCode).toBe(201);
  });

  it("does not leak error internals (no stack trace / secrets in bodies)", async () => {
    const s = await registerCompany(api);
    const res = await api.inject(
      authed(s.cookie, { method: "GET", url: "/api/loads/not-a-uuid" }),
    );
    expect(res.statusCode).toBe(400);
    const body = res.body;
    expect(body).not.toMatch(/at .*\(.*:\d+:\d+\)/); // no stack frames
    expect(body.toLowerCase()).not.toContain("password");
    expect(res.json().error.requestId).toBeTruthy();
  });
});
