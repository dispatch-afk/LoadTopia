import type { PrismaClient } from "@loadtopia/db";
import { FakeStorageProvider } from "@loadtopia/providers";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { providersWithFakeStorage } from "./helpers";
import {
  authed,
  createLocation,
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

suite("rate confirmations (integration)", () => {
  let prisma: PrismaClient;
  let api: FastifyInstance;
  let fake: FakeStorageProvider;

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
    fake = new FakeStorageProvider();
    api = await makeAppWithProviders(prisma, providersWithFakeStorage(fake).providers);
  });
  afterEach(async () => {
    await api?.close();
  });

  // ── fixtures ──────────────────────────────────────────────────────

  async function shipper(name = "Palermo Foods"): Promise<ShipperFx> {
    const s = await registerCompany(api, { type: "SHIPPER", companyName: name });
    await prisma.company.update({
      where: { id: s.companyId },
      data: { mcNumber: "MC777777", dotNumber: "DOT8888888" },
    });
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
        payload: {
          legalName: `${name} LLC`,
          mcNumber: "MC100001",
          dotNumber: "DOT2000001",
          equipmentTypes: [],
          serviceAreaStates: [],
        },
      }),
    );
    if (put.statusCode !== 200) throw new Error(`carrier profile ${put.statusCode}: ${put.body}`);
    await prisma.carrierProfile.update({
      where: { companyId: s.companyId },
      data: { marketplaceEligibility: "ELIGIBLE", verificationStatus: "VERIFIED" },
    });
    return s;
  }

  async function postedLoad(s: ShipperFx, over: Record<string, unknown> = {}): Promise<string> {
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
          ...over,
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

  async function makeOffer(c: Session, loadId: string, amount = "1850.00") {
    const res = await api.inject(
      authed(c.cookie, {
        method: "POST",
        url: `/api/marketplace/loads/${loadId}/offers`,
        payload: { amount, currency: "USD" },
      }),
    );
    if (res.statusCode !== 201) throw new Error(`makeOffer ${res.statusCode}: ${res.body}`);
    return res.json();
  }

  /** Full award via the real endpoint. Returns { loadId, winner, roundId }. */
  async function award(
    s: ShipperFx,
    winnerName = "Sunrise Carriers",
    amount = "1850.00",
  ): Promise<{ loadId: string; winner: Session; roundId: string }> {
    const loadId = await postedLoad(s);
    const winner = await carrier(winnerName);
    const thread = await makeOffer(winner, loadId, amount);
    const roundId = thread.rounds[0].id;
    const accept = await api.inject(
      authed(s.cookie, { method: "POST", url: `/api/offers/rounds/${roundId}/accept` }),
    );
    if (accept.statusCode !== 200) throw new Error(`accept ${accept.statusCode}: ${accept.body}`);
    return { loadId, winner, roundId };
  }

  const getRC = (cookie: string, loadId: string) =>
    api.inject(authed(cookie, { method: "GET", url: `/api/loads/${loadId}/rate-confirmation` }));

  // ── phase 1: the in-transaction commercial snapshot ──────────────

  it("a successful accept creates exactly one immutable snapshot with correct commercial values", async () => {
    const s = await shipper();
    const { loadId, winner, roundId } = await award(s, "Sunrise Carriers", "1850.00");

    const rows = await prisma.rateConfirmation.findMany({ where: { loadId } });
    expect(rows).toHaveLength(1);
    const rc = rows[0]!;

    const load = await prisma.load.findUniqueOrThrow({ where: { id: loadId } });
    const thread = await prisma.offerThread.findFirstOrThrow({ where: { loadId } });

    expect(rc.referenceNumber).toBe(`RC-${load.referenceNumber}`);
    expect(rc.agreedRate.toFixed(2)).toBe("1850.00");
    expect(rc.currency).toBe("USD");
    expect(rc.shipperCompanyId).toBe(s.companyId);
    expect(rc.shipperCompanyName).toBe("Palermo Foods");
    expect(rc.shipperMcNumber).toBe("MC777777");
    expect(rc.shipperDotNumber).toBe("DOT8888888");
    expect(rc.carrierCompanyId).toBe(winner.companyId);
    expect(rc.carrierCompanyName).toBe("Sunrise Carriers");
    expect(rc.carrierLegalName).toBe("Sunrise Carriers LLC");
    expect(rc.carrierMcNumber).toBe("MC100001");
    expect(rc.carrierDotNumber).toBe("DOT2000001");
    expect(rc.originCity).toBe("Chicago");
    expect(rc.originState).toBe("IL");
    expect(rc.destinationCity).toBe("Dallas");
    expect(rc.destinationState).toBe("TX");
    expect(rc.equipmentType).toBe("DRY_VAN");
    expect(rc.commodity).toBe("Palletized dry goods");
    expect(rc.weightLbs).toBe(38000);
    expect(rc.distanceMeters).toBe(load.distanceMeters);
    expect(rc.awardedOfferRoundId).toBe(roundId);
    expect(rc.pickupWindowStart?.getTime()).toBe(load.pickupWindowStart?.getTime());
    expect(rc.deliveryWindowEnd?.getTime()).toBe(load.deliveryWindowEnd?.getTime());
    // the exact same award timestamp, not an independent new Date()
    expect(rc.awardedAt.getTime()).toBe(load.awardedAt!.getTime());
    expect(rc.awardedAt.getTime()).toBe(thread.closedAt!.getTime());
  });

  it("the AWARDED event captures the acting shipper company (Correction 7)", async () => {
    const s = await shipper();
    const { loadId } = await award(s);
    const ev = await prisma.loadEvent.findFirstOrThrow({
      where: { loadId, type: "STATUS_CHANGED", toStatus: "AWARDED" },
    });
    expect(ev.actorCompanyId).toBe(s.companyId);
  });

  it("a rolled-back accept (expired offer) leaves no snapshot", async () => {
    const s = await shipper();
    const loadId = await postedLoad(s);
    const c = await carrier();

    const thread = await prisma.offerThread.create({
      data: { loadId, carrierCompanyId: c.companyId, status: "ACTIVE", roundCount: 1 },
    });
    const round = await prisma.offerRound.create({
      data: {
        threadId: thread.id,
        roundNumber: 1,
        proposedByCompanyId: c.companyId,
        proposedByUserId: c.userId,
        amount: "1800.00",
        currency: "USD",
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    await prisma.offerThread.update({
      where: { id: thread.id },
      data: { currentRoundId: round.id },
    });
    await prisma.load.update({ where: { id: loadId }, data: { status: "OFFER_RECEIVED" } });

    const accept = await api.inject(
      authed(s.cookie, { method: "POST", url: `/api/offers/rounds/${round.id}/accept` }),
    );
    expect(accept.statusCode).toBe(409);
    expect(await prisma.rateConfirmation.count({ where: { loadId } })).toBe(0);
  });

  it("two concurrent accepts of different carriers' offers → exactly one snapshot", async () => {
    const s = await shipper();
    const loadId = await postedLoad(s);
    const c1 = await carrier("Racer One");
    const c2 = await carrier("Racer Two");
    const r1 = (await makeOffer(c1, loadId, "1800.00")).rounds[0].id;
    const r2 = (await makeOffer(c2, loadId, "1700.00")).rounds[0].id;

    const [a, b] = await Promise.all([
      api.inject(authed(s.cookie, { method: "POST", url: `/api/offers/rounds/${r1}/accept` })),
      api.inject(authed(s.cookie, { method: "POST", url: `/api/offers/rounds/${r2}/accept` })),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);

    const rows = await prisma.rateConfirmation.findMany({ where: { loadId } });
    expect(rows).toHaveLength(1);
    const load = await prisma.load.findUniqueOrThrow({ where: { id: loadId } });
    expect(rows[0]!.carrierCompanyId).toBe(load.carrierCompanyId);
  });

  // ── DB-level immutability ────────────────────────────────────────

  it("the database rejects any commercial-field mutation but allows generation metadata; DELETE is blocked", async () => {
    const s = await shipper();
    const { loadId } = await award(s);
    const rc = await prisma.rateConfirmation.findUniqueOrThrow({ where: { loadId } });

    await expect(
      prisma.rateConfirmation.update({ where: { id: rc.id }, data: { agreedRate: "1.00" } }),
    ).rejects.toThrow();
    await expect(
      prisma.rateConfirmation.update({
        where: { id: rc.id },
        data: { carrierLegalName: "Someone Else LLC" },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.rateConfirmation.update({ where: { id: rc.id }, data: { awardedAt: new Date() } }),
    ).rejects.toThrow();

    // Generation metadata is the one permitted mutation.
    await expect(
      prisma.rateConfirmation.update({
        where: { id: rc.id },
        data: { status: "FAILED", generatedAt: null },
      }),
    ).resolves.toBeTruthy();

    await expect(prisma.rateConfirmation.delete({ where: { id: rc.id } })).rejects.toThrow();
  });

  // ── phase 2: deterministic rendering + storage ──────────────────

  it("post-commit generation stores the PDF under the deterministic key and marks it GENERATED", async () => {
    const s = await shipper();
    const { loadId } = await award(s);

    const rc = await prisma.rateConfirmation.findUniqueOrThrow({ where: { loadId } });
    expect(rc.storageKey).toBe(`rate-confirmations/${loadId}/${rc.id}.pdf`);
    expect(rc.status).toBe("GENERATED");
    expect(rc.generatedAt).not.toBeNull();

    expect(fake.storedKeys()).toEqual([rc.storageKey]);
    const stored = fake.getStored(rc.storageKey!)!;
    expect(stored.contentType).toBe("application/pdf");
    expect(Buffer.from(stored.body).toString("latin1").startsWith("%PDF-")).toBe(true);
  });

  it("a storage outage during the award never blocks it; retrieval regenerates later to the same key", async () => {
    fake.simulateOutage();
    const s = await shipper();
    const { loadId } = await award(s); // still 200 — award committed

    const load = await prisma.load.findUniqueOrThrow({ where: { id: loadId } });
    expect(load.status).toBe("AWARDED");
    const before = await prisma.rateConfirmation.findUniqueOrThrow({ where: { loadId } });
    expect(before.status).not.toBe("GENERATED");
    expect(fake.storedKeys()).toHaveLength(0);

    // Storage recovers; the lazy retrieval path completes generation.
    fake.simulateOutage(false);
    const res = await getRC(s.cookie, loadId);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("GENERATED");
    expect(res.json().download.url).toContain("fake-storage.test");
    expect(res.json().documentPending).toBe(false);

    const after = await prisma.rateConfirmation.findUniqueOrThrow({ where: { loadId } });
    expect(after.storageKey).toBe(before.storageKey); // identical deterministic key
    expect(fake.storedKeys()).toEqual([after.storageKey]);
  });

  it("a generation retry re-renders byte-identical content to the identical key", async () => {
    const s = await shipper();
    const { loadId } = await award(s);
    const rc = await prisma.rateConfirmation.findUniqueOrThrow({ where: { loadId } });
    const first = Buffer.from(fake.getStored(rc.storageKey!)!.body);

    // Force a re-render: mark not-generated + wipe the stored object.
    await prisma.rateConfirmation.updateMany({ where: { loadId }, data: { status: "FAILED" } });
    fake.clear();

    const res = await getRC(s.cookie, loadId);
    expect(res.statusCode).toBe(200);
    expect(fake.storedKeys()).toEqual([rc.storageKey]);
    expect(Buffer.from(fake.getStored(rc.storageKey!)!.body).equals(first)).toBe(true);
  });

  it("a GENERATED row whose object is missing (and storage down) is reported truthfully, not with a dead URL", async () => {
    const s = await shipper();
    const { loadId } = await award(s);
    // object vanished AND storage is unavailable → cannot reconcile now
    fake.clear();
    fake.simulateOutage();

    const res = await getRC(s.cookie, loadId);
    expect(res.statusCode).toBe(200);
    expect(res.json().download).toBeNull();
    expect(res.json().documentPending).toBe(true);
  });

  // ── retrieval authorization ─────────────────────────────────────

  it("the owning shipper and the winning carrier can retrieve it; everyone else 404s", async () => {
    const s = await shipper();
    const { loadId, winner } = await award(s);
    const loser = await carrier("Loser Co");
    const otherShipper = await shipper("Rival Foods");

    // winning carrier: authorized already at AWARDED (canReadLoad — carrierCompanyId is set at award)
    expect((await getRC(winner.cookie, loadId)).statusCode).toBe(200);
    expect((await getRC(s.cookie, loadId)).statusCode).toBe(200);

    // still authorized after assignment
    await api.inject(authed(s.cookie, { method: "POST", url: `/api/loads/${loadId}/assign` }));
    expect((await getRC(winner.cookie, loadId)).statusCode).toBe(200);

    // unassigned carrier + cross-company shipper: 404, never 403 (IDOR-safe)
    expect((await getRC(loser.cookie, loadId)).statusCode).toBe(404);
    expect((await getRC(otherShipper.cookie, loadId)).statusCode).toBe(404);
  });

  // ── historical loads ────────────────────────────────────────────

  it("a load awarded before this feature returns RATE_CONFIRMATION_NOT_AVAILABLE and is never backfilled", async () => {
    const s = await shipper();
    const loadId = await postedLoad(s);
    const c = await carrier();
    const thread = await makeOffer(c, loadId, "1900.00");
    const roundId = thread.rounds[0].id;

    // Award WITHOUT going through accept() — no rate_confirmations row.
    await prisma.$transaction(async (tx) => {
      await tx.load.update({
        where: { id: loadId },
        data: {
          status: "AWARDED",
          carrierCompanyId: c.companyId,
          awardedOfferRoundId: roundId,
          bookedRate: "1900.00",
          awardedAt: new Date(),
        },
      });
      await tx.offerThread.update({
        where: { id: thread.threadId },
        data: { status: "ACCEPTED", closedAt: new Date() },
      });
    });

    const res = await getRC(s.cookie, loadId);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("RATE_CONFIRMATION_NOT_AVAILABLE");
    // the failed retrieval fabricated nothing
    expect(await prisma.rateConfirmation.count({ where: { loadId } })).toBe(0);
  });

  // ── assignment must never touch the snapshot ─────────────────────

  it("AWARDED → CARRIER_ASSIGNED does not create, resnapshot, or mutate the Rate Confirmation", async () => {
    const s = await shipper();
    const { loadId } = await award(s);
    await getRC(s.cookie, loadId); // settle generation
    const before = await prisma.rateConfirmation.findUniqueOrThrow({ where: { loadId } });

    const assign = await api.inject(
      authed(s.cookie, { method: "POST", url: `/api/loads/${loadId}/assign` }),
    );
    expect(assign.statusCode).toBe(200);
    expect(assign.json().status).toBe("CARRIER_ASSIGNED");

    const after = await prisma.rateConfirmation.findMany({ where: { loadId } });
    expect(after).toHaveLength(1);
    expect(after[0]).toEqual(before); // byte-for-byte identical row, incl. awardedAt / storageKey / status
  });

  it("no Milestone 3 endpoint can re-award an already-awarded load (dormant AWARDED→POSTED stays unreachable)", async () => {
    const s = await shipper();
    const loadId = await postedLoad(s);
    const c1 = await carrier("First Co");
    const c2 = await carrier("Second Co");
    const r1 = (await makeOffer(c1, loadId, "1800.00")).rounds[0].id;
    const r2 = (await makeOffer(c2, loadId, "1700.00")).rounds[0].id;

    expect(
      (
        await api.inject(
          authed(s.cookie, { method: "POST", url: `/api/offers/rounds/${r1}/accept` }),
        )
      ).statusCode,
    ).toBe(200);
    // second accept + any lifecycle call cannot re-award
    expect(
      (
        await api.inject(
          authed(s.cookie, { method: "POST", url: `/api/offers/rounds/${r2}/accept` }),
        )
      ).statusCode,
    ).toBe(409);

    expect(await prisma.rateConfirmation.count({ where: { loadId } })).toBe(1);
    const events = await prisma.loadEvent.count({
      where: { loadId, type: "STATUS_CHANGED", toStatus: "AWARDED" },
    });
    expect(events).toBe(1);
  });

  // ── snapshot is frozen against later mutable-data drift ─────────

  it("mutating company / location / carrier-profile data after award never changes the snapshot", async () => {
    const s = await shipper();
    const { loadId, winner } = await award(s);
    const original = await prisma.rateConfirmation.findUniqueOrThrow({ where: { loadId } });

    await prisma.company.update({
      where: { id: s.companyId },
      data: { name: "Renamed Foods Inc" },
    });
    await prisma.carrierProfile.update({
      where: { companyId: winner.companyId },
      data: { legalName: "Totally Different LLC", mcNumber: "MC999999" },
    });
    await prisma.location.updateMany({
      where: { companyId: s.companyId },
      data: { city: "Elsewhere" },
    });

    const res = await getRC(s.cookie, loadId);
    expect(res.statusCode).toBe(200);
    const view = res.json();
    expect(view.shipper.companyName).toBe("Palermo Foods");
    expect(view.carrier.legalName).toBe("Sunrise Carriers LLC");
    expect(view.carrier.mcNumber).toBe("MC100001");
    expect(view.origin.city).toBe("Chicago");

    const reread = await prisma.rateConfirmation.findUniqueOrThrow({ where: { loadId } });
    expect({ ...reread, status: original.status, generatedAt: original.generatedAt }).toEqual({
      ...original,
    });
  });

  // ── no live calls ───────────────────────────────────────────────

  it("makes no live storage or Google calls — the fake stores in-process and providers are mock", async () => {
    const s = await shipper();
    const { loadId } = await award(s);
    await getRC(s.cookie, loadId);

    // FakeStorageProvider is in-process; everything else is a mock adapter.
    expect(fake.isMock).toBe(false);
    expect(fake.storedKeys()).toHaveLength(1);
    const providers = providersWithFakeStorage(fake).providers;
    for (const name of ["routing", "geocoding", "pricing", "notification", "tracking"] as const) {
      expect(providers[name].isMock).toBe(true);
    }
  });
});
