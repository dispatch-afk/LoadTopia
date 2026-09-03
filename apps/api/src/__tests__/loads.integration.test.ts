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
  type Session,
} from "./it-harness";

const suite = TEST_DB_URL ? describe : describe.skip;

const future = (days: number, hour = 8) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

suite("loads (integration)", () => {
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

  async function shipperWithLocations(): Promise<Session & { origin: string; dest: string }> {
    const s = await registerCompany(api, { companyName: "Palermo Foods" });
    const origin = await createLocation(api, s.cookie, { name: "Origin DC", city: "Milwaukee", state: "WI" });
    const dest = await createLocation(api, s.cookie, { name: "Dest", city: "Chicago", state: "IL" });
    return { ...s, origin, dest };
  }

  const draftPayload = (origin: string, dest: string) => ({
    originLocationId: origin,
    destinationLocationId: dest,
    equipmentType: "DRY_VAN",
    mode: "FTL",
    commodity: "Palletized dry goods",
    weightLbs: 38000,
    pickupWindowStart: future(3, 8),
    pickupWindowEnd: future(3, 16),
    deliveryWindowStart: future(5, 8),
    deliveryWindowEnd: future(5, 17),
  });

  it("creates a DRAFT load: server generates the number, calls RoutingProvider, stores miles + drive time, and writes a CREATED event", async () => {
    const s = await shipperWithLocations();
    const res = await api.inject(
      authed(s.cookie, { method: "POST", url: "/api/loads", payload: draftPayload(s.origin, s.dest) }),
    );
    expect(res.statusCode).toBe(201);
    const load = res.json();

    expect(load.referenceNumber).toMatch(/^[A-Z0-9]{2,8}-\d{5}$/);
    expect(load.status).toBe("DRAFT");
    expect(load.routing.miles).toBeGreaterThan(0);
    expect(load.routing.driveTimeMinutes).toBeGreaterThan(0);
    expect(load.routing.provider).toBe("mock");
    expect(load.routing.isMock).toBe(true);
    expect(load.events).toHaveLength(1);
    expect(load.events[0].type).toBe("CREATED");
    expect(load.events[0].toStatus).toBe("DRAFT");

    // miles are the server's, derived from the stored provider distance
    const row = await prisma.load.findUniqueOrThrow({ where: { id: load.id } });
    expect(row.distanceMeters).toBeGreaterThan(0);
    expect(row.driveTimeMinutes).toBeGreaterThan(0);
    expect(row.referenceNumber).toBe(load.referenceNumber);
  });

  it("numbers loads sequentially per company", async () => {
    const s = await shipperWithLocations();
    const a = await api.inject(
      authed(s.cookie, { method: "POST", url: "/api/loads", payload: draftPayload(s.origin, s.dest) }),
    );
    const b = await api.inject(
      authed(s.cookie, { method: "POST", url: "/api/loads", payload: draftPayload(s.origin, s.dest) }),
    );
    const na = Number(a.json().referenceNumber.split("-")[1]);
    const nb = Number(b.json().referenceNumber.split("-")[1]);
    expect(nb).toBe(na + 1);
  });

  describe("validation", () => {
    it("rejects delivery before pickup", async () => {
      const s = await shipperWithLocations();
      const res = await api.inject(
        authed(s.cookie, {
          method: "POST",
          url: "/api/loads",
          payload: { ...draftPayload(s.origin, s.dest), deliveryWindowStart: future(1) },
        }),
      );
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects a window whose end precedes its start", async () => {
      const s = await shipperWithLocations();
      const res = await api.inject(
        authed(s.cookie, {
          method: "POST",
          url: "/api/loads",
          payload: { ...draftPayload(s.origin, s.dest), pickupWindowEnd: future(2) },
        }),
      );
      expect(res.statusCode).toBe(400);
    });

    it("rejects a negative weight and identical origin/destination", async () => {
      const s = await shipperWithLocations();
      const neg = await api.inject(
        authed(s.cookie, {
          method: "POST",
          url: "/api/loads",
          payload: { ...draftPayload(s.origin, s.dest), weightLbs: -1 },
        }),
      );
      expect(neg.statusCode).toBe(400);

      const same = await api.inject(
        authed(s.cookie, {
          method: "POST",
          url: "/api/loads",
          payload: { ...draftPayload(s.origin, s.origin) },
        }),
      );
      expect(same.statusCode).toBe(400);
    });

    it("rejects a location belonging to another company", async () => {
      const s = await shipperWithLocations();
      const other = await registerCompany(api);
      const foreignLoc = await createLocation(api, other.cookie);
      const res = await api.inject(
        authed(s.cookie, {
          method: "POST",
          url: "/api/loads",
          payload: { ...draftPayload(s.origin, s.dest), destinationLocationId: foreignLoc },
        }),
      );
      expect(res.statusCode).toBe(404);
    });

    it("never lets the client set status via create or update", async () => {
      const s = await shipperWithLocations();
      const create = await api.inject(
        authed(s.cookie, {
          method: "POST",
          url: "/api/loads",
          payload: { ...draftPayload(s.origin, s.dest), status: "COMPLETED" },
        }),
      );
      expect(create.statusCode).toBe(400); // strict schema rejects unknown key

      const ok = await api.inject(
        authed(s.cookie, { method: "POST", url: "/api/loads", payload: draftPayload(s.origin, s.dest) }),
      );
      const id = ok.json().id;
      const patch = await api.inject(
        authed(s.cookie, {
          method: "PATCH",
          url: `/api/loads/${id}`,
          payload: { status: "DELIVERED" },
        }),
      );
      expect(patch.statusCode).toBe(400);
      const still = await prisma.load.findUniqueOrThrow({ where: { id } });
      expect(still.status).toBe("DRAFT");
    });
  });

  describe("ownership / IDOR", () => {
    it("does not let another company read a load by guessing its UUID", async () => {
      const owner = await shipperWithLocations();
      const created = await api.inject(
        authed(owner.cookie, {
          method: "POST",
          url: "/api/loads",
          payload: draftPayload(owner.origin, owner.dest),
        }),
      );
      const loadId = created.json().id;

      const attacker = await registerCompany(api);
      for (const method of ["GET", "PATCH", "DELETE"] as const) {
        const res = await api.inject(
          authed(attacker.cookie, {
            method,
            url: `/api/loads/${loadId}`,
            ...(method === "PATCH" ? { payload: { commodity: "hax" } } : {}),
          }),
        );
        expect(res.statusCode, method).toBe(404);
      }
      for (const action of ["post", "cancel", "unpost"]) {
        const res = await api.inject(
          authed(attacker.cookie, { method: "POST", url: `/api/loads/${loadId}/${action}` }),
        );
        expect(res.statusCode, action).toBe(404);
      }

      // The load list is scoped to the caller's own company.
      const attackerList = await api.inject(
        authed(attacker.cookie, { method: "GET", url: "/api/loads" }),
      );
      expect(attackerList.json().data).toHaveLength(0);
    });
  });

  describe("lifecycle / state machine", () => {
    it("DRAFT -> POSTED -> DRAFT -> CANCELLED, each writing an immutable event", async () => {
      const s = await shipperWithLocations();
      const created = await api.inject(
        authed(s.cookie, { method: "POST", url: "/api/loads", payload: draftPayload(s.origin, s.dest) }),
      );
      const id = created.json().id;

      const posted = await api.inject(
        authed(s.cookie, { method: "POST", url: `/api/loads/${id}/post` }),
      );
      expect(posted.statusCode).toBe(200);
      expect(posted.json().status).toBe("POSTED");
      expect(posted.json().postedAt).toBeTruthy();

      const unposted = await api.inject(
        authed(s.cookie, { method: "POST", url: `/api/loads/${id}/unpost` }),
      );
      expect(unposted.json().status).toBe("DRAFT");

      const cancelled = await api.inject(
        authed(s.cookie, {
          method: "POST",
          url: `/api/loads/${id}/cancel`,
          payload: { reason: "customer cancelled the order" },
        }),
      );
      expect(cancelled.statusCode).toBe(200);
      expect(cancelled.json().status).toBe("CANCELLED");

      const events = await prisma.loadEvent.findMany({
        where: { loadId: id },
        orderBy: { createdAt: "asc" },
      });
      expect(events.map((e) => e.type)).toEqual([
        "CREATED",
        "STATUS_CHANGED",
        "STATUS_CHANGED",
        "STATUS_CHANGED",
      ]);
      expect(events.at(-1)!.note).toBe("customer cancelled the order");
    });

    it("rejects posting an incomplete load and any illegal transition", async () => {
      const s = await shipperWithLocations();
      const created = await api.inject(
        authed(s.cookie, {
          method: "POST",
          url: "/api/loads",
          payload: {
            originLocationId: s.origin,
            destinationLocationId: s.dest,
            equipmentType: "DRY_VAN",
          },
        }),
      );
      const id = created.json().id;

      const post = await api.inject(authed(s.cookie, { method: "POST", url: `/api/loads/${id}/post` }));
      expect(post.statusCode).toBe(400);
      expect(post.json().error.code).toBe("VALIDATION_ERROR");

      // Cannot unpost a DRAFT load (illegal transition).
      const unpost = await api.inject(
        authed(s.cookie, { method: "POST", url: `/api/loads/${id}/unpost` }),
      );
      expect(unpost.statusCode).toBe(409);
      expect(unpost.json().error.code).toBe("INVALID_LOAD_TRANSITION");
    });

    it("refuses to edit or delete a POSTED load", async () => {
      const s = await shipperWithLocations();
      const created = await api.inject(
        authed(s.cookie, { method: "POST", url: "/api/loads", payload: draftPayload(s.origin, s.dest) }),
      );
      const id = created.json().id;
      await api.inject(authed(s.cookie, { method: "POST", url: `/api/loads/${id}/post` }));

      const patch = await api.inject(
        authed(s.cookie, {
          method: "PATCH",
          url: `/api/loads/${id}`,
          payload: { commodity: "changed" },
        }),
      );
      expect(patch.statusCode).toBe(409);

      const del = await api.inject(authed(s.cookie, { method: "DELETE", url: `/api/loads/${id}` }));
      expect(del.statusCode).toBe(409);
    });

    it("hard-deletes a DRAFT load and its CREATED event", async () => {
      const s = await shipperWithLocations();
      const created = await api.inject(
        authed(s.cookie, { method: "POST", url: "/api/loads", payload: draftPayload(s.origin, s.dest) }),
      );
      const id = created.json().id;
      const del = await api.inject(authed(s.cookie, { method: "DELETE", url: `/api/loads/${id}` }));
      expect(del.statusCode).toBe(204);
      expect(await prisma.load.findUnique({ where: { id } })).toBeNull();
      expect(await prisma.loadEvent.count({ where: { loadId: id } })).toBe(0);
    });
  });

  describe("immutable load events", () => {
    it("rejects UPDATE and DELETE of a historical event at the database level", async () => {
      const s = await shipperWithLocations();
      const created = await api.inject(
        authed(s.cookie, { method: "POST", url: "/api/loads", payload: draftPayload(s.origin, s.dest) }),
      );
      await api.inject(authed(s.cookie, { method: "POST", url: `/api/loads/${created.json().id}/post` }));
      const event = await prisma.loadEvent.findFirstOrThrow({
        where: { loadId: created.json().id, type: "STATUS_CHANGED" },
      });

      await expect(
        prisma.loadEvent.update({ where: { id: event.id }, data: { note: "tampered" } }),
      ).rejects.toThrow();
      await expect(
        prisma.loadEvent.delete({ where: { id: event.id } }),
      ).rejects.toThrow();

      const still = await prisma.loadEvent.findUniqueOrThrow({ where: { id: event.id } });
      expect(still.note).toBeNull();
    });
  });

  it("re-routes when origin/destination changes on a DRAFT load", async () => {
    const s = await shipperWithLocations();
    const third = await createLocation(api, s.cookie, { name: "Far", city: "Dallas", state: "TX" });
    const created = await api.inject(
      authed(s.cookie, { method: "POST", url: "/api/loads", payload: draftPayload(s.origin, s.dest) }),
    );
    const id = created.json().id;
    const beforeMiles = created.json().routing.miles;

    const patched = await api.inject(
      authed(s.cookie, {
        method: "PATCH",
        url: `/api/loads/${id}`,
        payload: { destinationLocationId: third },
      }),
    );
    expect(patched.statusCode).toBe(200);
    expect(patched.json().routing.miles).not.toBe(beforeMiles);
    expect(patched.json().events.map((e: { type: string }) => e.type)).toContain("UPDATED");
  });
});
