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

type ShipperFx = Session & { origin: string; dest: string };

suite("Book at Posted Rate — commercial agreement (M4 Phase 5, integration)", () => {
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
    const origin = await createLocation(api, s.cookie, { name: "Origin", city: "Chicago", state: "IL" });
    const dest = await createLocation(api, s.cookie, { name: "Dest", city: "Dallas", state: "TX" });
    return { ...s, origin, dest };
  }

  async function carrier(
    name = "Sunrise Carriers",
    opts: { equipmentTypes?: string[] } = {},
  ): Promise<Session> {
    const s = await registerCompany(api, { type: "CARRIER", companyName: name });
    const put = await api.inject(
      authed(s.cookie, {
        method: "PUT",
        url: "/api/carrier/profile",
        payload: {
          legalName: `${name} LLC`,
          equipmentTypes: opts.equipmentTypes ?? [],
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

  async function draftLoad(
    s: ShipperFx,
    over: Record<string, unknown> = {},
  ): Promise<{ id: string; commercialMode: string; postedRate: string | null }> {
    const res = await api.inject(
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
    if (res.statusCode !== 201) throw new Error(`draftLoad ${res.statusCode}: ${res.body}`);
    return res.json();
  }

  /** Post a load. With no `payload`, the route defaults to MARKETPLACE — an
   *  explicit empty object would NOT trigger that default (it's a defined
   *  body), so this helper omits the key entirely rather than defaulting it
   *  to `{}`. */
  async function postWith(s: Session, loadId: string, payload?: Record<string, unknown>) {
    return api.inject(
      authed(s.cookie, {
        method: "POST",
        url: `/api/loads/${loadId}/post`,
        ...(payload ? { payload } : {}),
      }),
    );
  }

  async function unpost(s: Session, loadId: string) {
    return api.inject(authed(s.cookie, { method: "POST", url: `/api/loads/${loadId}/unpost` }));
  }

  async function editLoad(s: Session, loadId: string, payload: Record<string, unknown>) {
    return api.inject(
      authed(s.cookie, { method: "PATCH", url: `/api/loads/${loadId}`, payload }),
    );
  }

  /** DRAFT -> POSTED, PUBLISH_RATE at `rate`, MARKETPLACE audience by default. */
  async function publishedLoad(
    s: ShipperFx,
    rate = "4000.00",
    over: Record<string, unknown> = {},
  ): Promise<string> {
    const load = await draftLoad(s, { commercialMode: "PUBLISH_RATE", postedRate: rate, ...over });
    const posted = await postWith(s, load.id);
    if (posted.statusCode !== 200) throw new Error(`post ${posted.statusCode}: ${posted.body}`);
    return load.id;
  }

  async function requestConnection(from: Session, toCompanyId: string) {
    return api.inject(
      authed(from.cookie, { method: "POST", url: `/api/companies/${toCompanyId}/connections` }),
    );
  }
  async function connected(shipperS: Session, carrierS: Session): Promise<void> {
    const req = await requestConnection(shipperS, carrierS.companyId);
    expect(req.statusCode).toBe(201);
    const accept = await api.inject(
      authed(carrierS.cookie, {
        method: "POST",
        url: `/api/connections/${req.json().id}/accept`,
      }),
    );
    expect(accept.statusCode).toBe(200);
  }

  async function book(c: Session, loadId: string, confirmedRate: string) {
    return api.inject(
      authed(c.cookie, {
        method: "POST",
        url: `/api/marketplace/loads/${loadId}/book`,
        payload: { confirmedRate },
      }),
    );
  }

  async function offer(c: Session, loadId: string, amount = "1500.00") {
    return api.inject(
      authed(c.cookie, {
        method: "POST",
        url: `/api/marketplace/loads/${loadId}/offers`,
        payload: { amount, currency: "USD" },
      }),
    );
  }

  // ── commercial-mode validation at create/edit ───────────────────────

  describe("commercial-mode validation", () => {
    it("rejects PUBLISH_RATE with no posted rate", async () => {
      const s = await shipper();
      const res = await api.inject(
        authed(s.cookie, {
          method: "POST",
          url: "/api/loads",
          payload: {
            originLocationId: s.origin,
            destinationLocationId: s.dest,
            equipmentType: "DRY_VAN",
            mode: "FTL",
            commercialMode: "PUBLISH_RATE",
          },
        }),
      );
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("INVALID_COMMERCIAL_MODE");
    });

    it("rejects REQUEST_OFFERS carrying a posted rate", async () => {
      const s = await shipper();
      const res = await api.inject(
        authed(s.cookie, {
          method: "POST",
          url: "/api/loads",
          payload: {
            originLocationId: s.origin,
            destinationLocationId: s.dest,
            equipmentType: "DRY_VAN",
            mode: "FTL",
            commercialMode: "REQUEST_OFFERS",
            postedRate: "4000.00",
          },
        }),
      );
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("INVALID_COMMERCIAL_MODE");
    });

    it("a new load defaults to REQUEST_OFFERS with no posted rate — historically truthful", async () => {
      const s = await shipper();
      const load = await draftLoad(s);
      expect(load.commercialMode).toBe("REQUEST_OFFERS");
      expect(load.postedRate).toBeNull();
    });

    it("a mock pricing snapshot at posting never populates postedRate", async () => {
      const s = await shipper();
      const load = await draftLoad(s);
      const posted = await postWith(s, load.id);
      expect(posted.statusCode).toBe(200);
      // posting always attempts a best-effort PricingSnapshot — confirm it
      // never wrote into the load's own commercial fields.
      const after = await prisma.load.findUniqueOrThrow({ where: { id: load.id } });
      expect(after.commercialMode).toBe("REQUEST_OFFERS");
      expect(after.postedRate).toBeNull();
    });

    it("commercial terms are locked once posted — same rule as every other load field", async () => {
      const s = await shipper();
      const loadId = await publishedLoad(s, "4000.00");
      const res = await api.inject(
        authed(s.cookie, {
          method: "PATCH",
          url: `/api/loads/${loadId}`,
          payload: { postedRate: "5000.00" },
        }),
      );
      expect(res.statusCode).toBe(409);
      const after = await prisma.load.findUniqueOrThrow({ where: { id: loadId } });
      expect(after.postedRate?.toFixed(2)).toBe("4000.00");
    });
  });

  // ── booking success ─────────────────────────────────────────────────

  it("booking creates a truthful shipper-originated round, awards, auto-assigns, and snapshots the RC", async () => {
    const s = await shipper();
    const c = await carrier("Booking Co");
    const loadId = await publishedLoad(s, "4000.00");

    const res = await book(c, loadId, "4000.00");
    expect(res.statusCode).toBe(200);
    const thread = res.json();
    expect(thread.status).toBe("ACCEPTED");
    expect(thread.originType).toBe("POSTED_RATE_BOOKING");
    expect(thread.currentAmount).toBe("4000.00");
    expect(thread.currentCurrency).toBe("USD");
    expect(thread.rounds).toHaveLength(1);
    expect(thread.rounds[0].proposedByParty).toBe("SHIPPER");

    const load = await prisma.load.findUniqueOrThrow({ where: { id: loadId } });
    expect(load.status).toBe("CARRIER_ASSIGNED"); // auto-assigned, same transaction
    expect(load.carrierCompanyId).toBe(c.companyId);
    expect(load.bookedRate?.toFixed(2)).toBe("4000.00");
    expect(load.currency).toBe("USD");
    expect(load.assignedAt).not.toBeNull();

    const dbThread = await prisma.offerThread.findFirstOrThrow({ where: { loadId } });
    expect(dbThread.originType).toBe("POSTED_RATE_BOOKING");
    const dbRound = await prisma.offerRound.findFirstOrThrow({ where: { threadId: dbThread.id } });
    expect(dbRound.proposedByCompanyId).toBe(s.companyId); // the SHIPPER, never the booking carrier

    const events = await prisma.loadEvent.findMany({
      where: { loadId, type: "STATUS_CHANGED", toStatus: { in: ["AWARDED", "CARRIER_ASSIGNED"] } },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.toStatus)).toEqual(["AWARDED", "CARRIER_ASSIGNED"]);

    const rc = await prisma.rateConfirmation.findUniqueOrThrow({ where: { loadId } });
    expect(rc.agreedRate.toFixed(2)).toBe("4000.00");
    expect(rc.currency).toBe("USD");
    expect(rc.carrierCompanyId).toBe(c.companyId);
  });

  it("competing negotiated offers are rejected when a booking wins", async () => {
    const s = await shipper();
    const winner = await carrier("Winner Co");
    const loser = await carrier("Loser Co");
    const loadId = await publishedLoad(s, "4000.00");

    await offer(loser, loadId, "3500.00");
    const res = await book(winner, loadId, "4000.00");
    expect(res.statusCode).toBe(200);

    const threads = await prisma.offerThread.findMany({ where: { loadId } });
    const byCarrier = Object.fromEntries(threads.map((t) => [t.carrierCompanyId, t.status]));
    expect(byCarrier[winner.companyId]).toBe("ACCEPTED");
    expect(byCarrier[loser.companyId]).toBe("REJECTED");
  });

  it("a scheduled Phase 4 release is cancelled by a successful booking", async () => {
    const s = await shipper();
    const c = await carrier("Booking Co");
    await connected(s, c);
    const load = await draftLoad(s, { commercialMode: "PUBLISH_RATE", postedRate: "4000.00" });
    const releaseAt = new Date(Date.now() + 60_000).toISOString();
    const posted = await postWith(s, load.id, {
      strategy: "NETWORK_FIRST",
      releases: [{ toStage: "MARKETPLACE", releaseAt }],
    });
    expect(posted.statusCode).toBe(200);

    const res = await book(c, load.id, "4000.00");
    expect(res.statusCode).toBe(200);

    const view = await api.inject(authed(s.cookie, { method: "GET", url: `/api/loads/${load.id}` }));
    expect(view.json().audience.pendingReleases).toHaveLength(0);
  });

  // ── authorization / IDOR ─────────────────────────────────────────────

  it("a DRAFT load cannot be booked (404, IDOR-safe)", async () => {
    const s = await shipper();
    const c = await carrier();
    const load = await draftLoad(s, { commercialMode: "PUBLISH_RATE", postedRate: "4000.00" });
    const res = await book(c, load.id, "4000.00");
    expect(res.statusCode).toBe(404);
  });

  it("a carrier outside the current SELECTED audience cannot book (404, never a 403 leak)", async () => {
    const s = await shipper();
    const selected = await carrier("Selected Co");
    const outside = await carrier("Outside Co");
    await connected(s, selected);
    await connected(s, outside);
    const load = await draftLoad(s, { commercialMode: "PUBLISH_RATE", postedRate: "4000.00" });
    const posted = await postWith(s, load.id, {
      strategy: "SELECTED_FIRST",
      carrierCompanyIds: [selected.companyId],
      carrierGroupIds: [],
      releases: [],
    });
    expect(posted.statusCode).toBe(200);

    const res = await book(outside, load.id, "4000.00");
    expect(res.statusCode).toBe(404);
  });

  it("an ineligible carrier (equipment mismatch) cannot book", async () => {
    const s = await shipper();
    const c = await carrier("Reefer Only", { equipmentTypes: ["REEFER"] });
    const loadId = await publishedLoad(s, "4000.00"); // DRY_VAN
    const res = await book(c, loadId, "4000.00");
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("NOT_ELIGIBLE_FOR_LOAD");
  });

  it("a blocked carrier that was previously selected cannot book (404)", async () => {
    const s = await shipper();
    const c = await carrier("Blocked Co");
    await connected(s, c);
    const load = await draftLoad(s, { commercialMode: "PUBLISH_RATE", postedRate: "4000.00" });
    const posted = await postWith(s, load.id, {
      strategy: "SELECTED_FIRST",
      carrierCompanyIds: [c.companyId],
      carrierGroupIds: [],
      releases: [],
    });
    expect(posted.statusCode).toBe(200);

    const blockRes = await api.inject(
      authed(s.cookie, { method: "POST", url: `/api/companies/${c.companyId}/block` }),
    );
    expect(blockRes.statusCode).toBe(201);

    const res = await book(c, load.id, "4000.00");
    expect(res.statusCode).toBe(404);
  });

  // ── stale commercial terms — "what the user saw is not authority" ────

  // Both tests below simulate the authoritative commercial terms diverging
  // from what the carrier's page showed, via a direct DB mutation — the
  // same technique already used elsewhere in this suite (e.g. forcing a
  // Rate Confirmation into FAILED) to exercise "the server's current state
  // differs from the caller's stale view" without depending on any specific
  // shipper-facing mutation path. The invariant under test is purely
  // server-side: the booking transaction independently re-reads
  // `commercialMode`/`postedRate` and never trusts the confirmed value.

  it("a stale confirmed rate is rejected with a truthful conflict, not silently booked at the new rate", async () => {
    const s = await shipper();
    const c = await carrier("Booking Co");
    const loadId = await publishedLoad(s, "4000.00");

    // The authoritative rate changes underneath the carrier's cached view —
    // via the REAL shipper workflow (unpost -> edit -> repost), now that the
    // Phase 4 repost defect (see audience.service.ts#applyAudienceAtPosting)
    // is fixed. No direct Prisma mutation needed for this scenario.
    expect((await unpost(s, loadId)).statusCode).toBe(200);
    expect((await editLoad(s, loadId, { postedRate: "4500.00" })).statusCode).toBe(200);
    expect((await postWith(s, loadId)).statusCode).toBe(200);

    // The carrier still confirms the OLD rate it saw.
    const res = await book(c, loadId, "4000.00");
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("COMMERCIAL_TERMS_CHANGED");

    const after = await prisma.load.findUniqueOrThrow({ where: { id: loadId } });
    expect(after.status).toBe("POSTED"); // never silently awarded at the new rate
    expect(after.carrierCompanyId).toBeNull();
  });

  it("a stale commercial mode (switched to Request Offers) is rejected with a truthful conflict", async () => {
    const s = await shipper();
    const c = await carrier("Booking Co");
    const loadId = await publishedLoad(s, "4000.00");

    // The authoritative mode changes underneath the carrier's cached view —
    // via the real unpost -> edit -> repost workflow (see above).
    expect((await unpost(s, loadId)).statusCode).toBe(200);
    expect(
      (await editLoad(s, loadId, { commercialMode: "REQUEST_OFFERS", postedRate: null })).statusCode,
    ).toBe(200);
    expect((await postWith(s, loadId)).statusCode).toBe(200);

    const res = await book(c, loadId, "4000.00");
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("COMMERCIAL_TERMS_CHANGED");
  });

  // ── concurrency ───────────────────────────────────────────────────

  it("double-click booking is safe — a retried request returns the same accepted outcome", async () => {
    const s = await shipper();
    const c = await carrier("Booking Co");
    const loadId = await publishedLoad(s, "4000.00");

    const first = await book(c, loadId, "4000.00");
    expect(first.statusCode).toBe(200);
    const second = await book(c, loadId, "4000.00");
    expect(second.statusCode).toBe(200);
    expect(second.json().threadId).toBe(first.json().threadId);

    expect(await prisma.rateConfirmation.count({ where: { loadId } })).toBe(1);
    expect(await prisma.offerThread.count({ where: { loadId } })).toBe(1);
  });

  it("two carriers booking the same load concurrently → exactly one winner, one RC, no orphan thread for the loser", async () => {
    const s = await shipper();
    const c1 = await carrier("Racer One");
    const c2 = await carrier("Racer Two");
    const loadId = await publishedLoad(s, "4000.00");

    const [a, b] = await Promise.all([
      book(c1, loadId, "4000.00"),
      book(c2, loadId, "4000.00"),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);

    const threads = await prisma.offerThread.findMany({ where: { loadId } });
    expect(threads).toHaveLength(1); // the loser's transaction never created a row
    expect(threads[0]!.status).toBe("ACCEPTED");

    expect(await prisma.rateConfirmation.count({ where: { loadId } })).toBe(1);
    const load = await prisma.load.findUniqueOrThrow({ where: { id: loadId } });
    expect(load.status).toBe("CARRIER_ASSIGNED");
    expect([c1.companyId, c2.companyId]).toContain(load.carrierCompanyId);
  });

  it("Book at Posted Rate vs a negotiated Accept racing on the same load → exactly one winner", async () => {
    const s = await shipper();
    const negotiator = await carrier("Negotiator Co");
    const booker = await carrier("Booker Co");
    const loadId = await publishedLoad(s, "4000.00");

    const negotiated = await offer(negotiator, loadId, "3800.00");
    const roundId = negotiated.json().rounds[0].id;

    const [acceptRes, bookRes] = await Promise.all([
      api.inject(authed(s.cookie, { method: "POST", url: `/api/offers/rounds/${roundId}/accept` })),
      book(booker, loadId, "4000.00"),
    ]);
    expect([acceptRes.statusCode, bookRes.statusCode].sort()).toEqual([200, 409]);

    const threads = await prisma.offerThread.findMany({ where: { loadId } });
    expect(threads.filter((t) => t.status === "ACCEPTED")).toHaveLength(1);
    expect(await prisma.rateConfirmation.count({ where: { loadId } })).toBe(1);
    const events = await prisma.loadEvent.findMany({
      where: { loadId, type: "STATUS_CHANGED", toStatus: "AWARDED" },
    });
    expect(events).toHaveLength(1);
  });

  // ── legacy /assign ────────────────────────────────────────────────

  it("legacy /assign still works for a pre-Phase-5-style AWARDED record, and safely rejects an already-assigned one", async () => {
    const s = await shipper();
    const legacyCarrier = await carrier("Legacy Co");
    const loadId = await publishedLoad(s, "4000.00");
    // Simulate a historical AWARDED-but-not-assigned row (constructed
    // directly — no live code path produces this state going forward).
    await prisma.load.update({
      where: { id: loadId },
      data: {
        status: "AWARDED",
        carrierCompanyId: legacyCarrier.companyId,
        bookedRate: "4000.00",
        awardedAt: new Date(),
      },
    });
    const legacyAssign = await api.inject(
      authed(s.cookie, { method: "POST", url: `/api/loads/${loadId}/assign` }),
    );
    expect(legacyAssign.statusCode).toBe(200);
    expect(legacyAssign.json().status).toBe("CARRIER_ASSIGNED");

    // A NEW booking auto-assigns already — a further /assign call safely 409s.
    const s2 = await shipper("Two");
    const c2 = await carrier("Fresh Co");
    const load2 = await publishedLoad(s2, "3000.00");
    await book(c2, load2, "3000.00");
    const redundant = await api.inject(
      authed(s2.cookie, { method: "POST", url: `/api/loads/${load2}/assign` }),
    );
    expect(redundant.statusCode).toBe(409);
  });
});
