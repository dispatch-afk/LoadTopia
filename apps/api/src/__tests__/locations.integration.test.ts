import type { PrismaClient } from "@loadtopia/db";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashSessionToken } from "../lib/session";
import { authed, makeApp, makePrisma, registerCompany, resetDb, TEST_DB_URL } from "./it-harness";

const suite = TEST_DB_URL ? describe : describe.skip;

const payload = {
  name: "Chicago DC",
  addressLine1: "123 Canal St",
  city: "Chicago",
  state: "IL",
  postalCode: "60607",
  country: "US",
};

suite("locations (integration)", () => {
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

  it("creates a location, geocodes it via the provider abstraction, and lists it", async () => {
    const s = await registerCompany(api);
    const create = await api.inject(
      authed(s.cookie, { method: "POST", url: "/api/locations", payload }),
    );
    expect(create.statusCode).toBe(201);
    const loc = create.json();
    expect(loc.companyId).toBe(s.companyId);
    expect(loc.state).toBe("IL");
    expect(loc.isGeocoded).toBe(true);
    expect(loc.geocodedBy).toBe("mock"); // clearly identified as mock data
    expect(Number(loc.latitude)).toBeGreaterThan(0);

    const list = await api.inject(authed(s.cookie, { method: "GET", url: "/api/locations" }));
    expect(list.json().data).toHaveLength(1);
    expect(list.json().total).toBe(1);
  });

  it("validates the address server-side", async () => {
    const s = await registerCompany(api);
    const bad = await api.inject(
      authed(s.cookie, {
        method: "POST",
        url: "/api/locations",
        payload: { ...payload, state: "Illinois", postalCode: "" },
      }),
    );
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("denies cross-company read/update/delete with 404 (IDOR guard)", async () => {
    const a = await registerCompany(api);
    const b = await registerCompany(api);
    const created = await api.inject(
      authed(a.cookie, { method: "POST", url: "/api/locations", payload }),
    );
    const id = created.json().id;

    for (const method of ["GET", "PATCH", "DELETE"] as const) {
      const res = await api.inject(
        authed(b.cookie, {
          method,
          url: `/api/locations/${id}`,
          ...(method === "PATCH" ? { payload: { name: "hax" } } : {}),
        }),
      );
      expect(res.statusCode, method).toBe(404);
    }
    // unchanged
    const still = await api.inject(authed(a.cookie, { method: "GET", url: `/api/locations/${id}` }));
    expect(still.json().name).toBe("Chicago DC");
  });

  it("re-geocodes on address change and soft-deletes (deactivates)", async () => {
    const s = await registerCompany(api);
    const created = await api.inject(
      authed(s.cookie, { method: "POST", url: "/api/locations", payload }),
    );
    const id = created.json().id;
    const before = created.json().latitude;

    const patched = await api.inject(
      authed(s.cookie, {
        method: "PATCH",
        url: `/api/locations/${id}`,
        payload: { city: "Peoria", postalCode: "61602" },
      }),
    );
    expect(patched.statusCode).toBe(200);
    expect(patched.json().latitude).not.toBe(before);

    const del = await api.inject(authed(s.cookie, { method: "DELETE", url: `/api/locations/${id}` }));
    expect(del.statusCode).toBe(200);
    expect(del.json().isActive).toBe(false);

    const list = await api.inject(authed(s.cookie, { method: "GET", url: "/api/locations" }));
    expect(list.json().data).toHaveLength(0); // inactive hidden by default
  });

  it("returns 409 when the caller has no active company (staff account)", async () => {
    const user = await prisma.user.create({
      data: { email: "staff@it.test", passwordHash: "x", firstName: "S", lastName: "T" },
    });
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashSessionToken("staff-raw-token"),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const res = await api.inject(
      authed("staff-raw-token", { method: "GET", url: "/api/locations" }),
    );
    expect(res.statusCode).toBe(409);
  });
});
