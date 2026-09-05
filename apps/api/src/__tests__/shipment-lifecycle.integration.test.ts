import type { PrismaClient } from "@loadtopia/db";
import { FakeStorageProvider } from "@loadtopia/providers";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { providersWithFakeStorage } from "./helpers";
import {
  authed,
  createLocation,
  makeApp,
  makeAppWithProviders,
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

type ShipperFx = Session & { origin: string; dest: string };

suite("shipment operational lifecycle (integration)", () => {
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

  // ── fixtures ──────────────────────────────────────────────────────

  async function shipper(name = "Palermo Foods"): Promise<ShipperFx> {
    const s = await registerCompany(api, { type: "SHIPPER", companyName: name });
    const origin = await createLocation(api, s.cookie, {
      name: "Origin",
      city: "Chicago",
      state: "IL",
    });
    const dest = await createLocation(api, s.cookie, { name: "Dest", city: "Dallas", state: "TX" });
    return { ...s, origin, dest };
  }

  async function carrier(name = "Sunrise Carriers"): Promise<Session> {
    const s = await registerCompany(api, { type: "CARRIER", companyName: name });
    const put = await api.inject(
      authed(s.cookie, {
        method: "PUT",
        url: "/api/carrier/profile",
        payload: { legalName: `${name} LLC`, equipmentTypes: [], serviceAreaStates: [] },
      }),
    );
    if (put.statusCode !== 200) throw new Error(`carrier profile ${put.statusCode}: ${put.body}`);
    await prisma.carrierProfile.update({
      where: { companyId: s.companyId },
      data: { marketplaceEligibility: "ELIGIBLE", verificationStatus: "VERIFIED" },
    });
    return s;
  }

  async function postedLoad(s: ShipperFx): Promise<string> {
    const draft = await api.inject(
      authed(s.cookie, {
        method: "POST",
        url: "/api/loads",
        payload: {
          originLocationId: s.origin,
          destinationLocationId: s.dest,
          equipmentType: "DRY_VAN",
          mode: "FTL",
          commodity: "Palletized dry goods",
          weightLbs: 38000,
          pickupWindowStart: future(3, 8),
          pickupWindowEnd: future(3, 16),
          deliveryWindowStart: future(5, 8),
          deliveryWindowEnd: future(5, 17),
        },
      }),
    );
    if (draft.statusCode !== 201) throw new Error(`draftLoad ${draft.statusCode}: ${draft.body}`);
    const id = draft.json().id;
    const post = await api.inject(
      authed(s.cookie, { method: "POST", url: `/api/loads/${id}/post` }),
    );
    if (post.statusCode !== 200) throw new Error(`post ${post.statusCode}: ${post.body}`);
    return id;
  }

  /** Post → offer → accept → assign. Returns an assigned load ready to operate. */
  async function assignedLoad(s: ShipperFx, c: Session): Promise<string> {
    const loadId = await postedLoad(s);
    const offer = await api.inject(
      authed(c.cookie, {
        method: "POST",
        url: `/api/marketplace/loads/${loadId}/offers`,
        payload: { amount: "1850.00", currency: "USD" },
      }),
    );
    if (offer.statusCode !== 201) throw new Error(`offer ${offer.statusCode}: ${offer.body}`);
    const roundId = offer.json().rounds[0].id;
    const accept = await api.inject(
      authed(s.cookie, { method: "POST", url: `/api/offers/rounds/${roundId}/accept` }),
    );
    if (accept.statusCode !== 200) throw new Error(`accept ${accept.statusCode}: ${accept.body}`);
    const assign = await api.inject(
      authed(s.cookie, { method: "POST", url: `/api/loads/${loadId}/assign` }),
    );
    if (assign.statusCode !== 200) throw new Error(`assign ${assign.statusCode}: ${assign.body}`);
    return loadId;
  }

  const op = (cookie: string, loadId: string, verb: "pickup" | "in-transit" | "deliver") =>
    api.inject(authed(cookie, { method: "POST", url: `/api/loads/${loadId}/${verb}` }));

  const statusEvents = (loadId: string, toStatus: "PICKED_UP" | "IN_TRANSIT" | "DELIVERED") =>
    prisma.loadEvent.findMany({ where: { loadId, type: "STATUS_CHANGED", toStatus } });

  // ── pickup ───────────────────────────────────────────────────────

  it("the assigned carrier can pick up from CARRIER_ASSIGNED, and it is fully attributed", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);

    const res = await op(c.cookie, loadId, "pickup");
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("PICKED_UP");
    expect(res.json().pickedUpAt).toBeTruthy();

    const load = await prisma.load.findUniqueOrThrow({ where: { id: loadId } });
    expect(load.status).toBe("PICKED_UP");
    expect(load.pickedUpAt).not.toBeNull();
    expect(load.deliveredAt).toBeNull();
    expect(load.completedAt).toBeNull();

    const events = await statusEvents(loadId, "PICKED_UP");
    expect(events).toHaveLength(1);
    expect(events[0]!.fromStatus).toBe("CARRIER_ASSIGNED");
    expect(events[0]!.actorUserId).toBe(c.userId);
    expect(events[0]!.actorCompanyId).toBe(c.companyId);
  });

  it("the owning shipper cannot perform the carrier pickup (403, permission gate)", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);

    const res = await op(s.cookie, loadId, "pickup");
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
    const load = await prisma.load.findUniqueOrThrow({ where: { id: loadId } });
    expect(load.status).toBe("CARRIER_ASSIGNED");
  });

  it("a losing / unassigned carrier cannot pick up (404, IDOR-safe)", async () => {
    const s = await shipper();
    const winner = await carrier("Winner Co");
    const loser = await carrier("Loser Co");
    const loadId = await postedLoad(s);
    // both bid; winner is awarded + assigned
    await api.inject(
      authed(loser.cookie, {
        method: "POST",
        url: `/api/marketplace/loads/${loadId}/offers`,
        payload: { amount: "1700.00", currency: "USD" },
      }),
    );
    const wOffer = await api.inject(
      authed(winner.cookie, {
        method: "POST",
        url: `/api/marketplace/loads/${loadId}/offers`,
        payload: { amount: "1850.00", currency: "USD" },
      }),
    );
    await api.inject(
      authed(s.cookie, {
        method: "POST",
        url: `/api/offers/rounds/${wOffer.json().rounds[0].id}/accept`,
      }),
    );
    await api.inject(authed(s.cookie, { method: "POST", url: `/api/loads/${loadId}/assign` }));

    const res = await op(loser.cookie, loadId, "pickup");
    expect(res.statusCode).toBe(404);
  });

  it("a completely unrelated carrier cannot pick up (404)", async () => {
    const s = await shipper();
    const c = await carrier();
    const outsider = await carrier("Outsider Co");
    const loadId = await assignedLoad(s, c);

    const res = await op(outsider.cookie, loadId, "pickup");
    expect(res.statusCode).toBe(404);
    expect(await statusEvents(loadId, "PICKED_UP")).toHaveLength(0);
  });

  it("an actor lacking the SHIPMENT_OPERATE_ASSIGNED permission is blocked at the gate (403)", async () => {
    // A shipper-role user has no operational permission at all — the preHandler
    // rejects before any load-specific logic runs.
    const s = await shipper();
    const other = await shipper("Bystander Foods");
    const c = await carrier();
    const loadId = await assignedLoad(s, c);

    for (const cookie of [s.cookie, other.cookie]) {
      const res = await op(cookie, loadId, "pickup");
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("FORBIDDEN");
    }
  });

  it("a duplicate pickup conflicts (409) and never doubles the event", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);

    expect((await op(c.cookie, loadId, "pickup")).statusCode).toBe(200);
    const dup = await op(c.cookie, loadId, "pickup");
    expect(dup.statusCode).toBe(409);
    expect(await statusEvents(loadId, "PICKED_UP")).toHaveLength(1);
  });

  it("concurrent pickup requests → exactly one transition, one event, one timestamp", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);

    const [a, b] = await Promise.all([
      op(c.cookie, loadId, "pickup"),
      op(c.cookie, loadId, "pickup"),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);

    const events = await statusEvents(loadId, "PICKED_UP");
    expect(events).toHaveLength(1);
    const load = await prisma.load.findUniqueOrThrow({ where: { id: loadId } });
    expect(load.pickedUpAt).not.toBeNull();
  });

  it("an AWARDED (not yet assigned) load cannot use the pickup endpoint", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await postedLoad(s);
    const offer = await api.inject(
      authed(c.cookie, {
        method: "POST",
        url: `/api/marketplace/loads/${loadId}/offers`,
        payload: { amount: "1850.00", currency: "USD" },
      }),
    );
    await api.inject(
      authed(s.cookie, {
        method: "POST",
        url: `/api/offers/rounds/${offer.json().rounds[0].id}/accept`,
      }),
    );
    // AWARDED, not CARRIER_ASSIGNED — the winning carrier still cannot operate.
    const res = await op(c.cookie, loadId, "pickup");
    expect(res.statusCode).toBe(403); // canOperateShipment excludes the AWARDED window
    const load = await prisma.load.findUniqueOrThrow({ where: { id: loadId } });
    expect(load.status).toBe("AWARDED");
  });

  // ── in-transit ───────────────────────────────────────────────────

  it("the assigned carrier can move PICKED_UP → IN_TRANSIT without rewriting pickedUpAt", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);
    await op(c.cookie, loadId, "pickup");
    const afterPickup = await prisma.load.findUniqueOrThrow({ where: { id: loadId } });

    const res = await op(c.cookie, loadId, "in-transit");
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("IN_TRANSIT");

    const load = await prisma.load.findUniqueOrThrow({ where: { id: loadId } });
    expect(load.status).toBe("IN_TRANSIT");
    expect(load.pickedUpAt!.getTime()).toBe(afterPickup.pickedUpAt!.getTime()); // unchanged
    expect(load.deliveredAt).toBeNull();
    expect(await statusEvents(loadId, "IN_TRANSIT")).toHaveLength(1);
  });

  it("the shipper cannot perform the IN_TRANSIT movement", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);
    await op(c.cookie, loadId, "pickup");

    const res = await op(s.cookie, loadId, "in-transit");
    expect(res.statusCode).toBe(403);
  });

  it("a stale / duplicate in-transit conflicts (409)", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);
    await op(c.cookie, loadId, "pickup");
    await op(c.cookie, loadId, "in-transit");

    const dup = await op(c.cookie, loadId, "in-transit");
    expect(dup.statusCode).toBe(409);
    // in-transit straight from CARRIER_ASSIGNED (skipping pickup) also conflicts
    const s2 = await shipper("Second Shipper");
    const c2 = await carrier("Second Carrier");
    const fresh = await assignedLoad(s2, c2);
    expect((await op(c2.cookie, fresh, "in-transit")).statusCode).toBe(409);
    expect(await statusEvents(loadId, "IN_TRANSIT")).toHaveLength(1);
  });

  it("concurrent in-transit requests → exactly one event", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);
    await op(c.cookie, loadId, "pickup");

    const [a, b] = await Promise.all([
      op(c.cookie, loadId, "in-transit"),
      op(c.cookie, loadId, "in-transit"),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect(await statusEvents(loadId, "IN_TRANSIT")).toHaveLength(1);
  });

  // ── deliver ──────────────────────────────────────────────────────

  it("the assigned carrier can move IN_TRANSIT → DELIVERED; delivered_at set once, attributed to the carrier", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);
    await op(c.cookie, loadId, "pickup");
    await op(c.cookie, loadId, "in-transit");

    const res = await op(c.cookie, loadId, "deliver");
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("DELIVERED");
    expect(res.json().deliveredAt).toBeTruthy();

    const load = await prisma.load.findUniqueOrThrow({ where: { id: loadId } });
    expect(load.status).toBe("DELIVERED");
    expect(load.deliveredAt).not.toBeNull();
    expect(load.completedAt).toBeNull();

    const events = await statusEvents(loadId, "DELIVERED");
    expect(events).toHaveLength(1);
    expect(events[0]!.actorUserId).toBe(c.userId);
    expect(events[0]!.actorCompanyId).toBe(c.companyId);

    // deliver again → conflict, delivered_at untouched
    const again = await op(c.cookie, loadId, "deliver");
    expect(again.statusCode).toBe(409);
    const reread = await prisma.load.findUniqueOrThrow({ where: { id: loadId } });
    expect(reread.deliveredAt!.getTime()).toBe(load.deliveredAt!.getTime());
  });

  it("concurrent deliver requests → exactly one transition, one event", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);
    await op(c.cookie, loadId, "pickup");
    await op(c.cookie, loadId, "in-transit");

    const [a, b] = await Promise.all([
      op(c.cookie, loadId, "deliver"),
      op(c.cookie, loadId, "deliver"),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect(await statusEvents(loadId, "DELIVERED")).toHaveLength(1);
  });

  // ── completion stays unexposed ──────────────────────────────────

  it("there is no complete endpoint in this slice, for anyone", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);
    await op(c.cookie, loadId, "pickup");
    await op(c.cookie, loadId, "in-transit");
    await op(c.cookie, loadId, "deliver");

    for (const cookie of [c.cookie, s.cookie]) {
      const res = await api.inject(
        authed(cookie, { method: "POST", url: `/api/loads/${loadId}/complete` }),
      );
      expect(res.statusCode).toBe(404); // route does not exist
    }
    const load = await prisma.load.findUniqueOrThrow({ where: { id: loadId } });
    expect(load.status).toBe("DELIVERED");
    expect(load.completedAt).toBeNull();
  });

  // ── historical / pre-M3 loads ──────────────────────────────────

  it("a pre-M3 CARRIER_ASSIGNED load (no Rate Confirmation, no M3 events) can still pick up", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await postedLoad(s);
    const offer = await api.inject(
      authed(c.cookie, {
        method: "POST",
        url: `/api/marketplace/loads/${loadId}/offers`,
        payload: { amount: "1850.00", currency: "USD" },
      }),
    );
    const roundId = offer.json().rounds[0].id;
    const threadId = offer.json().threadId;

    // Award + assign WITHOUT accept()/assign() endpoints → no rate_confirmations row.
    await prisma.$transaction(async (tx) => {
      await tx.load.update({
        where: { id: loadId },
        data: {
          status: "CARRIER_ASSIGNED",
          carrierCompanyId: c.companyId,
          awardedOfferRoundId: roundId,
          bookedRate: "1850.00",
          awardedAt: new Date(),
          assignedAt: new Date(),
        },
      });
      await tx.offerThread.update({
        where: { id: threadId },
        data: { status: "ACCEPTED", closedAt: new Date() },
      });
    });
    expect(await prisma.rateConfirmation.count({ where: { loadId } })).toBe(0);

    const res = await op(c.cookie, loadId, "pickup");
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("PICKED_UP");
    // still no fabricated Rate Confirmation
    expect(await prisma.rateConfirmation.count({ where: { loadId } })).toBe(0);
  });

  // ── independence from Rate Confirmation / storage / routing / pricing ──

  it("operational transitions do not touch the Rate Confirmation, routing provenance, or pricing snapshots", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);

    const rcBefore = await prisma.rateConfirmation.findUniqueOrThrow({ where: { loadId } });
    const loadBefore = await prisma.load.findUniqueOrThrow({ where: { id: loadId } });
    const snapsBefore = await prisma.pricingSnapshot.count({ where: { loadId } });

    await op(c.cookie, loadId, "pickup");
    await op(c.cookie, loadId, "in-transit");
    await op(c.cookie, loadId, "deliver");

    const rcAfter = await prisma.rateConfirmation.findUniqueOrThrow({ where: { loadId } });
    const loadAfter = await prisma.load.findUniqueOrThrow({ where: { id: loadId } });
    expect(rcAfter).toEqual(rcBefore);
    expect(loadAfter.routingProvider).toBe(loadBefore.routingProvider);
    expect(loadAfter.distanceMeters).toBe(loadBefore.distanceMeters);
    expect(loadAfter.routedAt?.getTime()).toBe(loadBefore.routedAt?.getTime());
    expect(await prisma.pricingSnapshot.count({ where: { loadId } })).toBe(snapsBefore);
  });

  it("a Rate Confirmation stuck PENDING/FAILED does not block the lifecycle", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);
    // force the RC into a non-generated state
    await prisma.rateConfirmation.updateMany({ where: { loadId }, data: { status: "FAILED" } });

    expect((await op(c.cookie, loadId, "pickup")).statusCode).toBe(200);
    expect((await op(c.cookie, loadId, "in-transit")).statusCode).toBe(200);
    expect((await op(c.cookie, loadId, "deliver")).statusCode).toBe(200);
    const rc = await prisma.rateConfirmation.findUniqueOrThrow({ where: { loadId } });
    expect(rc.status).toBe("FAILED"); // untouched
  });

  it("a storage outage does not block pickup / in-transit / deliver", async () => {
    const fake = new FakeStorageProvider();
    fake.simulateOutage();
    const outageApi = await makeAppWithProviders(prisma, providersWithFakeStorage(fake).providers);
    try {
      const s = await registerCompany(outageApi, { type: "SHIPPER", companyName: "Outage Foods" });
      const origin = await createLocation(outageApi, s.cookie, { city: "Chicago", state: "IL" });
      const dest = await createLocation(outageApi, s.cookie, { city: "Dallas", state: "TX" });
      const cSess = await registerCompany(outageApi, {
        type: "CARRIER",
        companyName: "Outage Carrier",
      });
      await outageApi.inject(
        authed(cSess.cookie, {
          method: "PUT",
          url: "/api/carrier/profile",
          payload: { legalName: "Outage Carrier LLC", equipmentTypes: [], serviceAreaStates: [] },
        }),
      );
      await prisma.carrierProfile.update({
        where: { companyId: cSess.companyId },
        data: { marketplaceEligibility: "ELIGIBLE", verificationStatus: "VERIFIED" },
      });
      const sFx: ShipperFx = { ...s, origin, dest };
      // rebind fixtures to the outage app
      const draft = await outageApi.inject(
        authed(s.cookie, {
          method: "POST",
          url: "/api/loads",
          payload: {
            originLocationId: origin,
            destinationLocationId: dest,
            equipmentType: "DRY_VAN",
            mode: "FTL",
            commodity: "goods",
            weightLbs: 1000,
            pickupWindowStart: future(3),
            pickupWindowEnd: future(3, 16),
            deliveryWindowStart: future(5),
            deliveryWindowEnd: future(5, 17),
          },
        }),
      );
      const loadId = draft.json().id;
      await outageApi.inject(
        authed(s.cookie, { method: "POST", url: `/api/loads/${loadId}/post` }),
      );
      const offer = await outageApi.inject(
        authed(cSess.cookie, {
          method: "POST",
          url: `/api/marketplace/loads/${loadId}/offers`,
          payload: { amount: "1000.00", currency: "USD" },
        }),
      );
      await outageApi.inject(
        authed(s.cookie, {
          method: "POST",
          url: `/api/offers/rounds/${offer.json().rounds[0].id}/accept`,
        }),
      );
      await outageApi.inject(
        authed(s.cookie, { method: "POST", url: `/api/loads/${loadId}/assign` }),
      );
      void sFx;

      for (const verb of ["pickup", "in-transit", "deliver"] as const) {
        const res = await outageApi.inject(
          authed(cSess.cookie, { method: "POST", url: `/api/loads/${loadId}/${verb}` }),
        );
        expect(res.statusCode, verb).toBe(200);
      }
    } finally {
      await outageApi.close();
    }
  });

  // ── serialization ───────────────────────────────────────────────

  it("the load view exposes the operational timestamps (null until reached)", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);

    const assigned = await api.inject(
      authed(s.cookie, { method: "GET", url: `/api/loads/${loadId}` }),
    );
    expect(assigned.json().pickedUpAt).toBeNull();
    expect(assigned.json().deliveredAt).toBeNull();
    expect(assigned.json().completedAt).toBeNull();

    await op(c.cookie, loadId, "pickup");
    await op(c.cookie, loadId, "in-transit");
    await op(c.cookie, loadId, "deliver");

    const delivered = await api.inject(
      authed(s.cookie, { method: "GET", url: `/api/loads/${loadId}` }),
    );
    expect(delivered.json().pickedUpAt).toBeTruthy();
    expect(delivered.json().deliveredAt).toBeTruthy();
    expect(delivered.json().completedAt).toBeNull();
  });
});
