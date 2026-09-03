import type { PrismaClient } from "@loadtopia/db";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashSessionToken } from "../lib/session";
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

// Deterministic mock-verification inputs (see MockCarrierVerificationProvider).
const VERIFY_PASS = { mcNumber: "MC100001", dotNumber: "DOT2000001", legalName: "Reliable Freight LLC" };
const VERIFY_FAIL = { mcNumber: "MC900049", dotNumber: "DOT5000049", legalName: "Rejected Carrier 49" };

suite("marketplace (integration)", () => {
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

  async function shipper(name = "Palermo Foods"): Promise<Session & { origin: string; dest: string }> {
    const s = await registerCompany(api, { type: "SHIPPER", companyName: name });
    const origin = await createLocation(api, s.cookie, { name: "Origin", city: "Chicago", state: "IL" });
    const dest = await createLocation(api, s.cookie, { name: "Dest", city: "Dallas", state: "TX" });
    return { ...s, origin, dest };
  }

  async function draftLoad(
    s: Session & { origin: string; dest: string },
    over: Record<string, unknown> = {},
  ): Promise<string> {
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
    return res.json().id;
  }

  async function postedLoad(
    s: Session & { origin: string; dest: string },
    over: Record<string, unknown> = {},
  ): Promise<string> {
    const id = await draftLoad(s, over);
    const res = await api.inject(authed(s.cookie, { method: "POST", url: `/api/loads/${id}/post` }));
    if (res.statusCode !== 200) throw new Error(`post ${res.statusCode}: ${res.body}`);
    return id;
  }

  async function carrier(
    opts: {
      name?: string;
      equipmentTypes?: string[];
      serviceAreaStates?: string[];
      eligible?: boolean;
    } = {},
  ): Promise<Session> {
    const s = await registerCompany(api, {
      type: "CARRIER",
      companyName: opts.name ?? "Sunrise Carriers",
    });
    const put = await api.inject(
      authed(s.cookie, {
        method: "PUT",
        url: "/api/carrier/profile",
        payload: {
          legalName: opts.name ?? "Sunrise Carriers LLC",
          equipmentTypes: opts.equipmentTypes ?? [],
          serviceAreaStates: opts.serviceAreaStates ?? [],
        },
      }),
    );
    if (put.statusCode !== 200) throw new Error(`carrier profile ${put.statusCode}: ${put.body}`);
    if (opts.eligible !== false) {
      await prisma.carrierProfile.update({
        where: { companyId: s.companyId },
        data: { marketplaceEligibility: "ELIGIBLE", verificationStatus: "VERIFIED" },
      });
    }
    return s;
  }

  const offerBody = (amount: string, over: Record<string, unknown> = {}) => ({
    amount,
    currency: "USD",
    ...over,
  });

  async function makeOffer(c: Session, loadId: string, amount = "1850.00") {
    return api.inject(
      authed(c.cookie, {
        method: "POST",
        url: `/api/marketplace/loads/${loadId}/offers`,
        payload: offerBody(amount),
      }),
    );
  }

  // ── carrier profile & verification ───────────────────────────────

  it("verification: a passing mock verdict makes the profile ELIGIBLE; a failing one INELIGIBLE", async () => {
    const pass = await registerCompany(api, { type: "CARRIER", companyName: "Reliable" });
    await api.inject(
      authed(pass.cookie, {
        method: "PUT",
        url: "/api/carrier/profile",
        payload: { legalName: VERIFY_PASS.legalName, mcNumber: VERIFY_PASS.mcNumber, dotNumber: VERIFY_PASS.dotNumber, equipmentTypes: [], serviceAreaStates: [] },
      }),
    );
    const okv = await api.inject(authed(pass.cookie, { method: "POST", url: "/api/carrier/profile/verify" }));
    expect(okv.statusCode).toBe(200);
    expect(okv.json().profile.marketplaceEligibility).toBe("ELIGIBLE");
    expect(okv.json().profile.verification.status).toBe("VERIFIED");
    expect(okv.json().profile.verification.isMock).toBe(true);
    // The disclaimer must never claim to be FMCSA / DOT / government verification.
    expect(okv.json().profile.verification.note.toLowerCase()).toContain("not fmcsa");

    const fail = await registerCompany(api, { type: "CARRIER", companyName: "Rejected" });
    await api.inject(
      authed(fail.cookie, {
        method: "PUT",
        url: "/api/carrier/profile",
        payload: { legalName: VERIFY_FAIL.legalName, mcNumber: VERIFY_FAIL.mcNumber, dotNumber: VERIFY_FAIL.dotNumber, equipmentTypes: [], serviceAreaStates: [] },
      }),
    );
    const failv = await api.inject(authed(fail.cookie, { method: "POST", url: "/api/carrier/profile/verify" }));
    expect(failv.json().profile.marketplaceEligibility).toBe("INELIGIBLE");

    // Editing the profile resets eligibility to PENDING.
    const edit = await api.inject(
      authed(pass.cookie, {
        method: "PUT",
        url: "/api/carrier/profile",
        payload: { legalName: "Reliable Freight LLC", equipmentTypes: ["REEFER"], serviceAreaStates: [] },
      }),
    );
    expect(edit.json().profile.marketplaceEligibility).toBe("PENDING");
  });

  it("a shipper has no carrier profile endpoint access", async () => {
    const s = await shipper();
    const res = await api.inject(authed(s.cookie, { method: "GET", url: "/api/carrier/profile" }));
    expect(res.statusCode).toBe(403);
  });

  // ── board visibility ─────────────────────────────────────────────

  it("an eligible carrier sees POSTED loads on the board but never DRAFT / private loads", async () => {
    const s = await shipper();
    const posted = await postedLoad(s);
    await draftLoad(s); // stays DRAFT

    const c = await carrier();
    const board = await api.inject(authed(c.cookie, { method: "GET", url: "/api/marketplace/loads" }));
    expect(board.statusCode).toBe(200);
    const ids = board.json().data.map((l: { id: string }) => l.id);
    expect(ids).toEqual([posted]);
  });

  it("board access requires an ELIGIBLE profile", async () => {
    const s = await shipper();
    await postedLoad(s);
    const c = await carrier({ eligible: false });
    const board = await api.inject(authed(c.cookie, { method: "GET", url: "/api/marketplace/loads" }));
    expect(board.statusCode).toBe(403);
    expect(board.json().error.code).toBe("CARRIER_NOT_ELIGIBLE");
  });

  it("hard-filters the board by the carrier's own equipment and service area", async () => {
    const s = await shipper();
    const dryVan = await postedLoad(s);
    const reefer = await postedLoad(s, { equipmentType: "REEFER" });

    const c = await carrier({ equipmentTypes: ["DRY_VAN"], serviceAreaStates: ["IL"] });
    const board = await api.inject(authed(c.cookie, { method: "GET", url: "/api/marketplace/loads" }));
    expect(board.json().data.map((l: { id: string }) => l.id)).toEqual([dryVan]);
    expect(reefer).not.toEqual(dryVan);

    // A carrier that only serves TX origins sees neither (both originate IL).
    const txOnly = await carrier({ name: "TX Only", serviceAreaStates: ["TX"] });
    const board2 = await api.inject(authed(txOnly.cookie, { method: "GET", url: "/api/marketplace/loads" }));
    expect(board2.json().data).toHaveLength(0);
  });

  it("marketplace load detail 404s for a load that is not on the market (IDOR-safe)", async () => {
    const s = await shipper();
    const draft = await draftLoad(s);
    const c = await carrier();
    const res = await api.inject(authed(c.cookie, { method: "GET", url: `/api/marketplace/loads/${draft}` }));
    expect(res.statusCode).toBe(404);
  });

  // ── offers & negotiation ─────────────────────────────────────────

  it("creating an offer moves the load POSTED -> OFFER_RECEIVED and writes events", async () => {
    const s = await shipper();
    const loadId = await postedLoad(s);
    const c = await carrier();

    const res = await makeOffer(c, loadId, "1800.00");
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe("ACTIVE");
    expect(res.json().roundCount).toBe(1);
    expect(res.json().currentAmount).toBe("1800.00");

    const load = await prisma.load.findUniqueOrThrow({ where: { id: loadId } });
    expect(load.status).toBe("OFFER_RECEIVED");

    const statusEvents = await prisma.loadEvent.findMany({
      where: { loadId, type: "STATUS_CHANGED" },
      orderBy: { createdAt: "asc" },
    });
    expect(statusEvents.map((e) => e.toStatus)).toEqual(["POSTED", "OFFER_RECEIVED"]);

    const offerEvents = await prisma.offerEvent.findMany({ where: { threadId: res.json().threadId } });
    expect(offerEvents.map((e) => e.type)).toEqual(["CREATED"]);
  });

  it("a re-submitted identical first offer is idempotent (200, same thread)", async () => {
    const s = await shipper();
    const loadId = await postedLoad(s);
    const c = await carrier();
    const a = await makeOffer(c, loadId, "1800.00");
    const b = await makeOffer(c, loadId, "1800.00");
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(200);
    expect(b.json().threadId).toBe(a.json().threadId);
    expect(await prisma.offerThread.count({ where: { loadId } })).toBe(1);

    // A different amount on an existing active thread is a conflict.
    const c2 = await makeOffer(c, loadId, "1750.00");
    expect(c2.statusCode).toBe(409);
  });

  it("counteroffers preserve full immutable history; only the other party may respond", async () => {
    const s = await shipper();
    const loadId = await postedLoad(s);
    const c = await carrier();
    const created = await makeOffer(c, loadId, "2000.00");
    const threadId = created.json().threadId;
    const round1 = created.json().rounds[0].id;

    // The carrier just proposed — it cannot counter its own round.
    const selfCounter = await api.inject(
      authed(c.cookie, {
        method: "POST",
        url: `/api/offers/rounds/${round1}/counter`,
        payload: offerBody("1900.00"),
      }),
    );
    expect(selfCounter.statusCode).toBe(409);

    // The shipper counters down.
    const shipperCounter = await api.inject(
      authed(s.cookie, {
        method: "POST",
        url: `/api/offers/rounds/${round1}/counter`,
        payload: offerBody("1600.00"),
      }),
    );
    expect(shipperCounter.statusCode).toBe(200);
    expect(shipperCounter.json().roundCount).toBe(2);
    const round2 = shipperCounter.json().rounds[1].id;

    // The carrier counters back up.
    const carrierCounter = await api.inject(
      authed(c.cookie, {
        method: "POST",
        url: `/api/offers/rounds/${round2}/counter`,
        payload: offerBody("1750.00"),
      }),
    );
    expect(carrierCounter.statusCode).toBe(200);

    const rounds = await prisma.offerRound.findMany({
      where: { threadId },
      orderBy: { roundNumber: "asc" },
    });
    expect(rounds.map((r) => r.amount.toFixed(2))).toEqual(["2000.00", "1600.00", "1750.00"]);
    expect(rounds[1]?.parentRoundId).toBe(round1);
    expect(rounds[2]?.parentRoundId).toBe(round2);

    // Countering a stale (non-current) round fails.
    const stale = await api.inject(
      authed(s.cookie, {
        method: "POST",
        url: `/api/offers/rounds/${round1}/counter`,
        payload: offerBody("1500.00"),
      }),
    );
    expect(stale.statusCode).toBe(409);
  });

  it("a carrier cannot see another carrier's negotiation; the shipper sees them all", async () => {
    const s = await shipper();
    const loadId = await postedLoad(s);
    const c1 = await carrier({ name: "Carrier One" });
    const c2 = await carrier({ name: "Carrier Two" });
    const t1 = (await makeOffer(c1, loadId, "1800.00")).json().threadId;
    const t2 = (await makeOffer(c2, loadId, "1700.00")).json().threadId;

    const cross = await api.inject(authed(c1.cookie, { method: "GET", url: `/api/offers/threads/${t2}` }));
    expect(cross.statusCode).toBe(404);

    const mine = await api.inject(authed(c1.cookie, { method: "GET", url: "/api/offers" }));
    expect(mine.json().data.map((t: { threadId: string }) => t.threadId)).toEqual([t1]);
    // Carrier view never carries the competing carrier's identity.
    expect(mine.json().data[0].carrier).toBeNull();

    const shipperView = await api.inject(authed(s.cookie, { method: "GET", url: `/api/loads/${loadId}/offers` }));
    const threads = shipperView.json().data;
    expect(threads.map((t: { threadId: string }) => t.threadId).sort()).toEqual([t1, t2].sort());
    expect(threads.every((t: { carrier: unknown }) => t.carrier !== null)).toBe(true);
  });

  // ── award ────────────────────────────────────────────────────────

  it("accepting an offer awards the load atomically and auto-rejects competitors", async () => {
    const s = await shipper();
    const loadId = await postedLoad(s);
    const c1 = await carrier({ name: "Winner" });
    const c2 = await carrier({ name: "Loser" });
    const t1 = (await makeOffer(c1, loadId, "1800.00")).json();
    await makeOffer(c2, loadId, "1700.00");
    const winningRound = t1.rounds[0].id;

    const accept = await api.inject(
      authed(s.cookie, { method: "POST", url: `/api/offers/rounds/${winningRound}/accept` }),
    );
    expect(accept.statusCode).toBe(200);
    expect(accept.json().status).toBe("ACCEPTED");

    const load = await prisma.load.findUniqueOrThrow({ where: { id: loadId } });
    expect(load.status).toBe("AWARDED");
    expect(load.carrierCompanyId).toBe(c1.companyId);
    expect(load.bookedRate?.toFixed(2)).toBe("1800.00");
    expect(load.awardedOfferRoundId).toBe(winningRound);

    const threads = await prisma.offerThread.findMany({ where: { loadId } });
    const byStatus = Object.fromEntries(threads.map((t) => [t.carrierCompanyId, t.status]));
    expect(byStatus[c1.companyId]).toBe("ACCEPTED");
    expect(byStatus[c2.companyId]).toBe("REJECTED");

    // Exactly one ACCEPTED thread — enforced by the partial unique index too.
    expect(threads.filter((t) => t.status === "ACCEPTED")).toHaveLength(1);

    // The awarded load is no longer on the board.
    const board = await api.inject(authed(c2.cookie, { method: "GET", url: "/api/marketplace/loads" }));
    expect(board.json().data).toHaveLength(0);

    // Assign: AWARDED -> CARRIER_ASSIGNED.
    const assign = await api.inject(authed(s.cookie, { method: "POST", url: `/api/loads/${loadId}/assign` }));
    expect(assign.statusCode).toBe(200);
    expect(assign.json().status).toBe("CARRIER_ASSIGNED");
  });

  it("a load cannot be awarded twice", async () => {
    const s = await shipper();
    const loadId = await postedLoad(s);
    const c1 = await carrier({ name: "A" });
    const c2 = await carrier({ name: "B" });
    const r1 = (await makeOffer(c1, loadId, "1800.00")).json().rounds[0].id;
    const r2 = (await makeOffer(c2, loadId, "1700.00")).json().rounds[0].id;

    const first = await api.inject(authed(s.cookie, { method: "POST", url: `/api/offers/rounds/${r1}/accept` }));
    expect(first.statusCode).toBe(200);

    const second = await api.inject(authed(s.cookie, { method: "POST", url: `/api/offers/rounds/${r2}/accept` }));
    expect(second.statusCode).toBe(409);
    expect(["LOAD_ALREADY_AWARDED", "OFFER_NOT_ACTIVE"]).toContain(second.json().error.code);
  });

  it("an expired offer cannot be accepted", async () => {
    const s = await shipper();
    const loadId = await postedLoad(s);
    const c = await carrier();

    // Insert a thread whose current round already expired (rounds are immutable,
    // so we cannot back-date via the API — insert directly).
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
    await prisma.offerThread.update({ where: { id: thread.id }, data: { currentRoundId: round.id } });
    await prisma.load.update({ where: { id: loadId }, data: { status: "OFFER_RECEIVED" } });

    const accept = await api.inject(
      authed(s.cookie, { method: "POST", url: `/api/offers/rounds/${round.id}/accept` }),
    );
    expect(accept.statusCode).toBe(409);
    expect(accept.json().error.code).toBe("OFFER_EXPIRED");

    const t = await prisma.offerThread.findUniqueOrThrow({ where: { id: thread.id } });
    expect(t.status).toBe("EXPIRED");
  });

  // ── authorization / IDOR ─────────────────────────────────────────

  it("cross-company: an outsider carrier cannot accept or counter someone else's thread", async () => {
    const s = await shipper();
    const loadId = await postedLoad(s);
    const c1 = await carrier({ name: "Insider" });
    const outsider = await carrier({ name: "Outsider" });
    const created = (await makeOffer(c1, loadId, "1800.00")).json();
    const round = created.rounds[0].id;

    for (const url of [`/api/offers/rounds/${round}/counter`, `/api/offers/rounds/${round}/accept`]) {
      const res = await api.inject(
        authed(outsider.cookie, { method: "POST", url, payload: offerBody("1000.00") }),
      );
      expect(res.statusCode, url).toBe(404);
    }

    // A shipper cannot offer, and a carrier cannot use the shipper offer list.
    const shipperOffer = await makeOffer(s, loadId, "1500.00");
    expect(shipperOffer.statusCode).toBe(403);
  });

  // ── concurrency (MANDATORY) ──────────────────────────────────────

  it("concurrent accepts of two different carriers' offers → exactly one winner", async () => {
    const s = await shipper();
    const loadId = await postedLoad(s);
    const c1 = await carrier({ name: "Racer 1" });
    const c2 = await carrier({ name: "Racer 2" });
    const r1 = (await makeOffer(c1, loadId, "1800.00")).json().rounds[0].id;
    const r2 = (await makeOffer(c2, loadId, "1700.00")).json().rounds[0].id;

    const [a, b] = await Promise.all([
      api.inject(authed(s.cookie, { method: "POST", url: `/api/offers/rounds/${r1}/accept` })),
      api.inject(authed(s.cookie, { method: "POST", url: `/api/offers/rounds/${r2}/accept` })),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);

    const threads = await prisma.offerThread.findMany({ where: { loadId } });
    expect(threads.filter((t) => t.status === "ACCEPTED")).toHaveLength(1);
    expect(threads.filter((t) => t.status === "REJECTED")).toHaveLength(1);

    const load = await prisma.load.findUniqueOrThrow({ where: { id: loadId } });
    expect(load.status).toBe("AWARDED");
    // Exactly one carrier assignment.
    expect(load.carrierCompanyId).toBeTruthy();

    const awardEvents = await prisma.loadEvent.findMany({
      where: { loadId, type: "STATUS_CHANGED", toStatus: "AWARDED" },
    });
    expect(awardEvents).toHaveLength(1);
  });

  it("concurrent duplicate first offers by one carrier → a single thread", async () => {
    const s = await shipper();
    const loadId = await postedLoad(s);
    const c = await carrier();

    const results = await Promise.all([
      makeOffer(c, loadId, "1800.00"),
      makeOffer(c, loadId, "1800.00"),
      makeOffer(c, loadId, "1800.00"),
    ]);
    const codes = results.map((r) => r.statusCode);
    // Exactly one create wins; the losers of the race get 409 (or 200 if the
    // winner had already committed and became a visible idempotent replay).
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 200 || c === 409)).toHaveLength(2);
    // The DB unique constraint is the real guarantee: one thread, one round.
    expect(await prisma.offerThread.count({ where: { loadId } })).toBe(1);
    expect(await prisma.offerRound.count({ where: { thread: { loadId } } })).toBe(1);
  });

  it("concurrent counters on the same round → one wins, history stays linear", async () => {
    const s = await shipper();
    const loadId = await postedLoad(s);
    const c = await carrier();
    const round = (await makeOffer(c, loadId, "2000.00")).json().rounds[0].id;

    const [a, b] = await Promise.all([
      api.inject(authed(s.cookie, { method: "POST", url: `/api/offers/rounds/${round}/counter`, payload: offerBody("1600.00") })),
      api.inject(authed(s.cookie, { method: "POST", url: `/api/offers/rounds/${round}/counter`, payload: offerBody("1650.00") })),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);

    const rounds = await prisma.offerRound.findMany({ where: { thread: { loadId } } });
    expect(rounds).toHaveLength(2);
    expect(new Set(rounds.map((r) => r.roundNumber))).toEqual(new Set([1, 2]));
  });

  // ── DB-level immutability ────────────────────────────────────────

  it("offer_rounds and offer_events reject UPDATE / DELETE at the database level", async () => {
    const s = await shipper();
    const loadId = await postedLoad(s);
    const c = await carrier();
    const threadId = (await makeOffer(c, loadId, "1800.00")).json().threadId;
    const round = await prisma.offerRound.findFirstOrThrow({ where: { threadId } });
    const event = await prisma.offerEvent.findFirstOrThrow({ where: { threadId } });

    await expect(
      prisma.offerRound.update({ where: { id: round.id }, data: { amount: "1" } }),
    ).rejects.toThrow();
    await expect(prisma.offerRound.delete({ where: { id: round.id } })).rejects.toThrow();
    await expect(
      prisma.offerEvent.update({ where: { id: event.id }, data: { type: "REJECTED" } }),
    ).rejects.toThrow();
    await expect(prisma.offerEvent.delete({ where: { id: event.id } })).rejects.toThrow();
  });

  // ── admin ────────────────────────────────────────────────────────

  it("admin can override eligibility and read the marketplace overview", async () => {
    const admin = await makeAdmin(prisma);
    const s = await shipper();
    await postedLoad(s);
    const c = await carrier({ name: "Suspended Co", eligible: false });

    const patch = await api.inject(
      authed(admin, {
        method: "PATCH",
        url: `/api/admin/carrier-profiles/${c.companyId}`,
        payload: { marketplaceEligibility: "ELIGIBLE", reason: "manually reviewed" },
      }),
    );
    expect(patch.statusCode).toBe(200);
    expect(patch.json().profile.marketplaceEligibility).toBe("ELIGIBLE");

    const overview = await api.inject(authed(admin, { method: "GET", url: "/api/admin/marketplace/overview" }));
    expect(overview.statusCode).toBe(200);
    expect(overview.json().loads.posted).toBeGreaterThanOrEqual(1);
    expect(overview.json().providers.carrierVerification.isMock).toBe(true);
  });

  /** Create a platform-staff (ADMIN) session: a user with NO company membership. */
  async function makeAdmin(db: PrismaClient): Promise<string> {
    const user = await db.user.create({
      data: {
        email: `staff-${Date.now()}-${Math.random().toString(36).slice(2)}@it.test`,
        passwordHash: "unused",
        firstName: "Platform",
        lastName: "Staff",
      },
    });
    const token = `admin-it-${user.id}`;
    await db.session.create({
      data: {
        userId: user.id,
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    return token;
  }
});
