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

suite("manual check-ins (integration)", () => {
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

  /** Post → offer → accept → assign. Returns { loadId }. */
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
    await api.inject(
      authed(s.cookie, {
        method: "POST",
        url: `/api/offers/rounds/${offer.json().rounds[0].id}/accept`,
      }),
    );
    const assign = await api.inject(
      authed(s.cookie, { method: "POST", url: `/api/loads/${loadId}/assign` }),
    );
    if (assign.statusCode !== 200) throw new Error(`assign ${assign.statusCode}: ${assign.body}`);
    return loadId;
  }

  const move = (cookie: string, loadId: string, verb: "pickup" | "in-transit" | "deliver") =>
    api.inject(authed(cookie, { method: "POST", url: `/api/loads/${loadId}/${verb}` }));

  const postCheckIn = (cookie: string, loadId: string, body: Record<string, unknown>) =>
    api.inject(
      authed(cookie, { method: "POST", url: `/api/loads/${loadId}/check-ins`, payload: body }),
    );

  const getCheckIns = (cookie: string, loadId: string) =>
    api.inject(authed(cookie, { method: "GET", url: `/api/loads/${loadId}/check-ins` }));

  const CHI = { city: "Chicago", state: "IL" };

  // ── allowed lifecycle window ────────────────────────────────────

  it("the assigned carrier can check in at every operational status (assigned → delivered)", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);

    expect((await postCheckIn(c.cookie, loadId, { ...CHI, note: "at yard" })).statusCode).toBe(201);
    await move(c.cookie, loadId, "pickup");
    expect((await postCheckIn(c.cookie, loadId, { city: "Joliet", state: "IL" })).statusCode).toBe(
      201,
    );
    await move(c.cookie, loadId, "in-transit");
    expect(
      (await postCheckIn(c.cookie, loadId, { city: "St Louis", state: "MO" })).statusCode,
    ).toBe(201);
    await move(c.cookie, loadId, "deliver");
    expect((await postCheckIn(c.cookie, loadId, { city: "Dallas", state: "TX" })).statusCode).toBe(
      201,
    );

    const list = await getCheckIns(s.cookie, loadId);
    expect(list.json().data).toHaveLength(4);
  });

  it("an AWARDED (not yet assigned) load rejects check-ins", async () => {
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
    // AWARDED: canOperateShipment excludes this window → 403
    const res = await postCheckIn(c.cookie, loadId, CHI);
    expect(res.statusCode).toBe(403);
    expect(await prisma.loadCheckIn.count({ where: { loadId } })).toBe(0);
  });

  it("a COMPLETED load rejects check-ins (409), reads still work", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);
    await move(c.cookie, loadId, "pickup");
    await move(c.cookie, loadId, "in-transit");
    await move(c.cookie, loadId, "deliver");
    await postCheckIn(c.cookie, loadId, CHI); // one before completion
    // safely force COMPLETED without an endpoint
    await prisma.load.update({
      where: { id: loadId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    const res = await postCheckIn(c.cookie, loadId, { city: "Late", state: "TX" });
    expect(res.statusCode).toBe(409);
    expect((await getCheckIns(c.cookie, loadId)).json().data).toHaveLength(1);
  });

  // ── write authorization ────────────────────────────────────────

  it("the owning shipper cannot create a check-in (403), but a losing/unrelated carrier gets 404", async () => {
    const s = await shipper();
    const c = await carrier();
    const loser = await carrier("Loser Co");
    const outsider = await carrier("Outsider Co");
    const loadId = await assignedLoad(s, c);

    expect((await postCheckIn(s.cookie, loadId, CHI)).statusCode).toBe(403); // permission gate
    expect((await postCheckIn(loser.cookie, loadId, CHI)).statusCode).toBe(404); // cannot read the load
    expect((await postCheckIn(outsider.cookie, loadId, CHI)).statusCode).toBe(404);
    expect(await prisma.loadCheckIn.count({ where: { loadId } })).toBe(0);
  });

  it("a cross-company carrier (assigned elsewhere) cannot check in on someone else's load", async () => {
    const s1 = await shipper("Shipper One");
    const c1 = await carrier("Carrier One");
    const load1 = await assignedLoad(s1, c1);
    const s2 = await shipper("Shipper Two");
    const c2 = await carrier("Carrier Two");
    await assignedLoad(s2, c2);

    expect((await postCheckIn(c2.cookie, load1, CHI)).statusCode).toBe(404);
  });

  // ── request validation ────────────────────────────────────────

  it("rejects malformed bodies (missing city/state, bad coords, half a pair, unknown fields)", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);

    const bad: Record<string, unknown>[] = [
      { state: "IL" },
      { city: "Chicago" },
      { city: "   ", state: "IL" },
      { ...CHI, note: "x".repeat(1001) },
      { ...CHI, latitude: 91, longitude: 0 },
      { ...CHI, latitude: 0, longitude: 181 },
      { ...CHI, latitude: 41.9 }, // longitude missing
      { ...CHI, longitude: -87.6 }, // latitude missing
      { ...CHI, recordedAt: new Date().toISOString() }, // server-authoritative
      { ...CHI, actorCompanyId: c.companyId },
    ];
    for (const body of bad) {
      const res = await postCheckIn(c.cookie, loadId, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(await prisma.loadCheckIn.count({ where: { loadId } })).toBe(0);
  });

  it("stores a full coordinate pair, trims/normalizes city+state, and keeps note verbatim (no HTML handling)", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);

    const res = await postCheckIn(c.cookie, loadId, {
      city: "  Chicago ",
      state: "il",
      note: "  <b>note</b> stays literal  ",
      latitude: 41.878113,
      longitude: -87.629799,
    });
    expect(res.statusCode).toBe(201);
    const v = res.json();
    expect(v.city).toBe("Chicago");
    expect(v.state).toBe("IL");
    expect(v.note).toBe("<b>note</b> stays literal");
    expect(Number(v.latitude)).toBeCloseTo(41.878113, 5);
    expect(Number(v.longitude)).toBeCloseTo(-87.629799, 5);

    const row = await prisma.loadCheckIn.findFirstOrThrow({ where: { loadId } });
    expect(row.latitude).not.toBeNull();
    expect(row.longitude).not.toBeNull();
  });

  it("accepts a check-in with neither coordinate", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);
    const res = await postCheckIn(c.cookie, loadId, CHI);
    expect(res.statusCode).toBe(201);
    expect(res.json().latitude).toBeNull();
    expect(res.json().longitude).toBeNull();
  });

  // ── server-authoritative time + attribution + event ────────────

  it("recordedAt is server-generated; the check-in and its single CHECK_IN_ADDED event are correctly attributed", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);

    const t0 = Date.now();
    const res = await postCheckIn(c.cookie, loadId, { ...CHI, note: "departing" });
    const t1 = Date.now();
    expect(res.statusCode).toBe(201);
    const checkInId = res.json().id;

    const recordedAt = new Date(res.json().recordedAt).getTime();
    expect(recordedAt).toBeGreaterThanOrEqual(t0 - 1000);
    expect(recordedAt).toBeLessThanOrEqual(t1 + 1000);

    const row = await prisma.loadCheckIn.findUniqueOrThrow({ where: { id: checkInId } });
    expect(row.actorUserId).toBe(c.userId);

    const events = await prisma.loadEvent.findMany({
      where: { loadId, type: "CHECK_IN_ADDED" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.actorUserId).toBe(c.userId);
    expect(events[0]!.actorCompanyId).toBe(c.companyId);
    expect((events[0]!.data as { checkInId: string }).checkInId).toBe(checkInId);
  });

  it("a rejected check-in creates neither a row nor an event", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);

    expect((await postCheckIn(c.cookie, loadId, { city: "", state: "IL" })).statusCode).toBe(400);
    expect((await postCheckIn(s.cookie, loadId, CHI)).statusCode).toBe(403);

    expect(await prisma.loadCheckIn.count({ where: { loadId } })).toBe(0);
    expect(await prisma.loadEvent.count({ where: { loadId, type: "CHECK_IN_ADDED" } })).toBe(0);
  });

  // ── read authorization + ordering ──────────────────────────────

  it("GET is authorized for the shipper and the assigned carrier, 404 for everyone else", async () => {
    const s = await shipper();
    const c = await carrier();
    const loser = await carrier("Loser Co");
    const loadId = await assignedLoad(s, c);
    await postCheckIn(c.cookie, loadId, CHI);

    expect((await getCheckIns(s.cookie, loadId)).statusCode).toBe(200);
    expect((await getCheckIns(c.cookie, loadId)).statusCode).toBe(200);
    expect((await getCheckIns(loser.cookie, loadId)).statusCode).toBe(404);

    const otherShipper = await shipper("Rival Foods");
    expect((await getCheckIns(otherShipper.cookie, loadId)).statusCode).toBe(404);
  });

  it("returns check-ins in deterministic recordedAt ASC, id ASC order", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);

    for (const city of ["A City", "B City", "C City", "D City"]) {
      const r = await postCheckIn(c.cookie, loadId, { city, state: "IL" });
      expect(r.statusCode).toBe(201);
    }
    const list = (await getCheckIns(s.cookie, loadId)).json().data as {
      city: string;
      recordedAt: string;
    }[];
    expect(list.map((x) => x.city)).toEqual(["A City", "B City", "C City", "D City"]);
    const times = list.map((x) => new Date(x.recordedAt).getTime());
    expect([...times]).toEqual([...times].sort((a, b) => a - b));
  });

  it("two legitimate close-together check-ins are both created (no false dedupe)", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);

    const [a, b] = await Promise.all([
      postCheckIn(c.cookie, loadId, { ...CHI, note: "first" }),
      postCheckIn(c.cookie, loadId, { ...CHI, note: "second" }),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    expect(a.json().id).not.toBe(b.json().id);
    expect(await prisma.loadCheckIn.count({ where: { loadId } })).toBe(2);
    expect(await prisma.loadEvent.count({ where: { loadId, type: "CHECK_IN_ADDED" } })).toBe(2);
  });

  // ── no mutation endpoints ──────────────────────────────────────

  it("exposes no PATCH or DELETE for a check-in", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);
    const id = (await postCheckIn(c.cookie, loadId, CHI)).json().id;

    for (const method of ["PATCH", "DELETE", "PUT"] as const) {
      const res = await api.inject(
        authed(c.cookie, { method, url: `/api/loads/${loadId}/check-ins/${id}` }),
      );
      expect(res.statusCode, method).toBe(404);
    }
  });

  // ── independence: storage / Rate Confirmation / routing / pricing ──

  it("a check-in does not touch the Rate Confirmation, routing provenance, or pricing snapshots", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);

    const rcBefore = await prisma.rateConfirmation.findUniqueOrThrow({ where: { loadId } });
    const loadBefore = await prisma.load.findUniqueOrThrow({ where: { id: loadId } });
    const snapsBefore = await prisma.pricingSnapshot.count({ where: { loadId } });

    await postCheckIn(c.cookie, loadId, { ...CHI, latitude: 41.9, longitude: -87.6 });

    const rcAfter = await prisma.rateConfirmation.findUniqueOrThrow({ where: { loadId } });
    const loadAfter = await prisma.load.findUniqueOrThrow({ where: { id: loadId } });
    expect(rcAfter).toEqual(rcBefore);
    expect(loadAfter.routingProvider).toBe(loadBefore.routingProvider);
    expect(loadAfter.distanceMeters).toBe(loadBefore.distanceMeters);
    expect(loadAfter.routedAt?.getTime()).toBe(loadBefore.routedAt?.getTime());
    expect(await prisma.pricingSnapshot.count({ where: { loadId } })).toBe(snapsBefore);
  });

  it("a storage outage does not block manual check-ins", async () => {
    const fake = new FakeStorageProvider();
    fake.simulateOutage();
    const outageApi = await makeAppWithProviders(prisma, providersWithFakeStorage(fake).providers);
    try {
      const s = await registerCompany(outageApi, { type: "SHIPPER", companyName: "Outage Foods" });
      const origin = await createLocation(outageApi, s.cookie, { city: "Chicago", state: "IL" });
      const dest = await createLocation(outageApi, s.cookie, { city: "Dallas", state: "TX" });
      const c = await registerCompany(outageApi, {
        type: "CARRIER",
        companyName: "Outage Carrier",
      });
      await outageApi.inject(
        authed(c.cookie, {
          method: "PUT",
          url: "/api/carrier/profile",
          payload: { legalName: "Outage Carrier LLC", equipmentTypes: [], serviceAreaStates: [] },
        }),
      );
      await prisma.carrierProfile.update({
        where: { companyId: c.companyId },
        data: { marketplaceEligibility: "ELIGIBLE", verificationStatus: "VERIFIED" },
      });
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
        authed(c.cookie, {
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

      const res = await outageApi.inject(
        authed(c.cookie, {
          method: "POST",
          url: `/api/loads/${loadId}/check-ins`,
          payload: { city: "Chicago", state: "IL" },
        }),
      );
      expect(res.statusCode).toBe(201);
    } finally {
      await outageApi.close();
    }
  });

  // ── historical loads ──────────────────────────────────────────

  it("a pre-M3 CARRIER_ASSIGNED load (no Rate Confirmation) can receive check-ins", async () => {
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
    await prisma.$transaction(async (tx) => {
      await tx.load.update({
        where: { id: loadId },
        data: {
          status: "CARRIER_ASSIGNED",
          carrierCompanyId: c.companyId,
          awardedOfferRoundId: offer.json().rounds[0].id,
          bookedRate: "1850.00",
          awardedAt: new Date(),
          assignedAt: new Date(),
        },
      });
      await tx.offerThread.update({
        where: { id: offer.json().threadId },
        data: { status: "ACCEPTED", closedAt: new Date() },
      });
    });
    expect(await prisma.rateConfirmation.count({ where: { loadId } })).toBe(0);

    const res = await postCheckIn(c.cookie, loadId, CHI);
    expect(res.statusCode).toBe(201);
    expect(await prisma.rateConfirmation.count({ where: { loadId } })).toBe(0);
  });
});
