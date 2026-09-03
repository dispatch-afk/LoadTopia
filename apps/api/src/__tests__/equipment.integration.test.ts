import type { PrismaClient } from "@loadtopia/db";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authed, makeApp, makePrisma, registerCompany, resetDb, TEST_DB_URL } from "./it-harness";

const suite = TEST_DB_URL ? describe : describe.skip;

suite("equipment (integration)", () => {
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

  const payload = { type: "REEFER", name: "Reefer 12", trailerLengthFt: 53, capacityLbs: 44000 };

  it("creates, reads, updates and deactivates equipment scoped to the company", async () => {
    const s = await registerCompany(api, { type: "CARRIER" });

    const created = await api.inject(
      authed(s.cookie, { method: "POST", url: "/api/equipment", payload }),
    );
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect(created.json().companyId).toBe(s.companyId);

    const list = await api.inject(authed(s.cookie, { method: "GET", url: "/api/equipment" }));
    expect(list.json().data).toHaveLength(1);

    const patched = await api.inject(
      authed(s.cookie, {
        method: "PATCH",
        url: `/api/equipment/${id}`,
        payload: { capacityLbs: 45000, type: "CONESTOGA" },
      }),
    );
    expect(patched.statusCode).toBe(200);
    expect(patched.json().type).toBe("CONESTOGA");

    const del = await api.inject(authed(s.cookie, { method: "DELETE", url: `/api/equipment/${id}` }));
    expect(del.statusCode).toBe(200);
    expect(del.json().isActive).toBe(false);
    const after = await api.inject(authed(s.cookie, { method: "GET", url: "/api/equipment" }));
    expect(after.json().data).toHaveLength(0);
  });

  it("validates equipment values server-side", async () => {
    const s = await registerCompany(api);
    const bad = await api.inject(
      authed(s.cookie, {
        method: "POST",
        url: "/api/equipment",
        payload: { type: "MOON_LANDER", capacityLbs: -5 },
      }),
    );
    expect(bad.statusCode).toBe(400);
  });

  it("blocks a shipper from modifying another company's equipment (404)", async () => {
    const a = await registerCompany(api, { type: "CARRIER" });
    const b = await registerCompany(api, { type: "SHIPPER" });
    const created = await api.inject(
      authed(a.cookie, { method: "POST", url: "/api/equipment", payload }),
    );
    const id = created.json().id;

    const res = await api.inject(
      authed(b.cookie, {
        method: "PATCH",
        url: `/api/equipment/${id}`,
        payload: { capacityLbs: 1 },
      }),
    );
    expect(res.statusCode).toBe(404);

    const untouched = await prisma.equipment.findUniqueOrThrow({ where: { id } });
    expect(untouched.capacityLbs).toBe(44000);
  });
});
