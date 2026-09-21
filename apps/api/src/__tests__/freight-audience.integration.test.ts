import type { PrismaClient } from "@loadtopia/db";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { executeOneRelease, processDueReleases } from "../modules/loads/release-engine";
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

suite("freight audience strategy (M4 Phase 4, integration)", () => {
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

  async function postWith(s: Session, loadId: string, payload: Record<string, unknown>) {
    return api.inject(
      authed(s.cookie, { method: "POST", url: `/api/loads/${loadId}/post`, payload }),
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

  async function requestConnection(from: Session, toCompanyId: string) {
    return api.inject(
      authed(from.cookie, { method: "POST", url: `/api/companies/${toCompanyId}/connections` }),
    );
  }
  async function connected(shipperS: Session, carrierS: Session): Promise<string> {
    const req = await requestConnection(shipperS, carrierS.companyId);
    expect(req.statusCode).toBe(201);
    const connectionId = req.json().id;
    const accept = await api.inject(
      authed(carrierS.cookie, { method: "POST", url: `/api/connections/${connectionId}/accept` }),
    );
    expect(accept.statusCode).toBe(200);
    return connectionId;
  }
  async function disconnect(shipperS: Session, connectionId: string) {
    const res = await api.inject(
      authed(shipperS.cookie, { method: "POST", url: `/api/connections/${connectionId}/disconnect` }),
    );
    expect(res.statusCode).toBe(200);
  }
  async function reconnect(shipperS: Session, carrierS: Session): Promise<string> {
    return connected(shipperS, carrierS);
  }

  async function board(c: Session) {
    return api.inject(authed(c.cookie, { method: "GET", url: "/api/marketplace/loads" }));
  }
  async function detail(c: Session, loadId: string) {
    return api.inject(authed(c.cookie, { method: "GET", url: `/api/marketplace/loads/${loadId}` }));
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
  function idsOf(res: { json: () => { data: Array<{ id: string }> } }): string[] {
    return res.json().data.map((r) => r.id);
  }

  // ── DRAFT PRIVACY ───────────────────────────────────────────────

  describe("draft privacy", () => {
    it("a carrier cannot list, detail, or offer on a DRAFT load", async () => {
      const s = await shipper();
      const c = await carrier();
      const draftId = await draftLoad(s);

      expect(idsOf(await board(c))).not.toContain(draftId);
      expect((await detail(c, draftId)).statusCode).toBe(404);
      expect((await offer(c, draftId)).statusCode).toBe(404);
    });
  });

  // ── MARKETPLACE ─────────────────────────────────────────────────

  describe("Marketplace strategy", () => {
    it("an eligible carrier sees it; a blocked carrier never does", async () => {
      const s = await shipper();
      const c = await carrier();
      const blocked = await carrier("Blocked Co");
      const draftId = await draftLoad(s);
      const post = await postWith(s, draftId, { strategy: "MARKETPLACE" });
      expect(post.statusCode).toBe(200);
      expect(post.json().audience).toEqual(
        expect.objectContaining({ strategy: "MARKETPLACE", currentStage: "MARKETPLACE" }),
      );

      expect(idsOf(await board(c))).toContain(draftId);

      await api.inject(
        authed(s.cookie, { method: "POST", url: `/api/companies/${blocked.companyId}/block` }),
      );
      expect(idsOf(await board(blocked))).not.toContain(draftId);
      expect((await detail(blocked, draftId)).statusCode).toBe(404);
    });

    it("an eligible carrier may see Marketplace freight without any Connection", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await draftLoad(s);
      await postWith(s, loadId, { strategy: "MARKETPLACE" });

      const res = await detail(c, loadId);
      expect(res.statusCode).toBe(200);
      expect(res.json().shipperIsConnected).toBe(false);
    });
  });

  // ── NETWORK FIRST ───────────────────────────────────────────────

  describe("Network First strategy", () => {
    it("an accepted connected carrier sees it; a non-connected carrier cannot", async () => {
      const s = await shipper();
      const netCarrier = await carrier("Network Carrier");
      const outsider = await carrier("Outsider Carrier");
      await connected(s, netCarrier);
      const loadId = await draftLoad(s);
      const post = await postWith(s, loadId, { strategy: "NETWORK_FIRST", releases: [] });
      expect(post.statusCode).toBe(200);
      expect(post.json().audience.currentStage).toBe("NETWORK");

      expect(idsOf(await board(netCarrier))).toContain(loadId);
      expect(idsOf(await board(outsider))).not.toContain(loadId);
      expect((await detail(outsider, loadId)).statusCode).toBe(404);
      expect((await offer(outsider, loadId)).statusCode).toBe(404);
    });

    it("a pending, declined, or disconnected carrier cannot see it", async () => {
      const s = await shipper();
      const pending = await carrier("Pending Carrier");
      await requestConnection(s, pending.companyId); // never accepted

      const declined = await carrier("Declined Carrier");
      const req2 = await requestConnection(s, declined.companyId);
      await api.inject(
        authed(declined.cookie, { method: "POST", url: `/api/connections/${req2.json().id}/decline` }),
      );

      const disconnected = await carrier("Disconnected Carrier");
      const connId = await connected(s, disconnected);
      await api.inject(
        authed(s.cookie, { method: "POST", url: `/api/connections/${connId}/disconnect` }),
      );

      const loadId = await draftLoad(s);
      await postWith(s, loadId, { strategy: "NETWORK_FIRST", releases: [] });

      for (const c of [pending, declined, disconnected]) {
        expect(idsOf(await board(c))).not.toContain(loadId);
      }
    });

    it("a carrier that only follows the shipper (never connected) cannot see it", async () => {
      const s = await shipper();
      const follower = await carrier("Follower Only");
      await api.inject(
        authed(follower.cookie, {
          method: "POST",
          url: `/api/companies/${s.companyId}/follow`,
        }),
      );
      const loadId = await draftLoad(s);
      await postWith(s, loadId, { strategy: "NETWORK_FIRST", releases: [] });

      expect(idsOf(await board(follower))).not.toContain(loadId);
    });

    it("posting Network First with zero eligible connected carriers is rejected", async () => {
      const s = await shipper();
      const loadId = await draftLoad(s);
      const res = await postWith(s, loadId, { strategy: "NETWORK_FIRST", releases: [] });
      expect(res.statusCode).toBe(409);
      const still = await api.inject(
        authed(s.cookie, { method: "GET", url: `/api/loads/${loadId}` }),
      );
      expect(still.json().status).toBe("DRAFT");
    });

    // ── Review correction #2: the NETWORK audience is SNAPSHOTTED when the
    // stage is established (at posting, for Network First), not live. ──

    it("freezes the NETWORK snapshot to exactly the carriers connected AT POST TIME", async () => {
      const s = await shipper();
      const a = await carrier("Network A");
      const b = await carrier("Network B");
      await connected(s, a);
      await connected(s, b);

      const loadId = await draftLoad(s);
      const post = await postWith(s, loadId, { strategy: "NETWORK_FIRST", releases: [] });
      expect(post.statusCode).toBe(200);
      expect(post.json().audience.audienceCount).toBe(2); // A, B frozen

      expect(idsOf(await board(a))).toContain(loadId);
      expect(idsOf(await board(b))).toContain(loadId);
    });

    it("a carrier who connects AFTER posting does not gain visibility to the already-established Network stage", async () => {
      const s = await shipper();
      const a = await carrier("Network A2");
      await connected(s, a);

      const loadId = await draftLoad(s);
      await postWith(s, loadId, { strategy: "NETWORK_FIRST", releases: [] });

      // C connects to the shipper AFTER the load was already posted.
      const c = await carrier("Late Joiner C");
      await connected(s, c);

      expect(idsOf(await board(a))).toContain(loadId);
      expect(idsOf(await board(c))).not.toContain(loadId);
      expect((await detail(c, loadId)).statusCode).toBe(404);
    });

    it("disconnect removes CURRENT visibility for a Network-snapshotted carrier, but the snapshot row survives, and reconnect restores visibility", async () => {
      const s = await shipper();
      const b = await carrier("Network B2");
      const connId = await connected(s, b);

      const loadId = await draftLoad(s);
      await postWith(s, loadId, { strategy: "NETWORK_FIRST", releases: [] });
      expect(idsOf(await board(b))).toContain(loadId);

      await disconnect(s, connId);
      expect(idsOf(await board(b))).not.toContain(loadId);
      expect((await detail(b, loadId)).statusCode).toBe(404);
      expect((await offer(b, loadId)).statusCode).toBe(404);

      // The frozen snapshot row itself is untouched by the disconnect.
      const snapshotRows = await prisma.loadAudienceMember.findMany({
        where: { loadId, carrierCompanyId: b.companyId, stage: "NETWORK" },
      });
      expect(snapshotRows).toHaveLength(1);

      // Reconnecting restores visibility — same unchanged snapshot, current
      // authorization becomes true again.
      await reconnect(s, b);
      expect(idsOf(await board(b))).toContain(loadId);
      expect((await detail(b, loadId)).statusCode).toBe(200);
    });
  });

  // ── SELECTED CARRIERS ───────────────────────────────────────────

  describe("Selected Carriers First strategy", () => {
    it("a selected carrier sees it; an unselected but connected carrier cannot, and identities never leak", async () => {
      const s = await shipper();
      const selected = await carrier("Selected Carrier");
      const unselected = await carrier("Unselected Carrier");
      await connected(s, selected);
      await connected(s, unselected);

      const loadId = await draftLoad(s);
      const post = await postWith(s, loadId, {
        strategy: "SELECTED_FIRST",
        carrierCompanyIds: [selected.companyId],
        carrierGroupIds: [],
        releases: [],
      });
      expect(post.statusCode).toBe(200);
      expect(post.json().audience.currentStage).toBe("SELECTED");
      expect(post.json().audience.audienceCount).toBe(1);

      expect(idsOf(await board(selected))).toContain(loadId);
      expect(idsOf(await board(unselected))).not.toContain(loadId);
      expect((await detail(unselected, loadId)).statusCode).toBe(404);

      // The selected carrier's own view never exposes who ELSE was selected.
      const view = await detail(selected, loadId);
      expect(JSON.stringify(view.json())).not.toContain(unselected.companyId);
      expect(JSON.stringify(view.json())).not.toContain("Unselected Carrier");
    });

    it("posting Selected Carriers First with zero valid carriers is rejected", async () => {
      const s = await shipper();
      const notConnected = await carrier("Never Connected");
      const loadId = await draftLoad(s);
      const res = await postWith(s, loadId, {
        strategy: "SELECTED_FIRST",
        carrierCompanyIds: [notConnected.companyId],
        carrierGroupIds: [],
        releases: [],
      });
      expect(res.statusCode).toBe(409);
    });
  });

  // ── Review correction #1: the SELECTED snapshot is historical truth, NOT
  // standing authorization — current visibility also requires a LIVE
  // ACCEPTED connection right now. Disconnect must remove current private-
  // freight access without touching the frozen snapshot or any historical
  // truth; a later reconnect naturally restores it. ──

  describe("Selected Carriers First — disconnect removes current access, reconnect restores it", () => {
    it("a selected carrier sees the load while the connection is ACCEPTED", async () => {
      const s = await shipper();
      const c = await carrier("Selected Then Disconnected");
      await connected(s, c);
      const loadId = await draftLoad(s);
      await postWith(s, loadId, {
        strategy: "SELECTED_FIRST",
        carrierCompanyIds: [c.companyId],
        carrierGroupIds: [],
        releases: [],
      });

      expect(idsOf(await board(c))).toContain(loadId);
      expect((await detail(c, loadId)).statusCode).toBe(200);
    });

    it("disconnect removes list visibility, makes detail privacy-safe (404), and prevents offer creation — without erasing the snapshot or historical truth", async () => {
      const s = await shipper();
      const c = await carrier("Selected Then Disconnected 2");
      const connId = await connected(s, c);
      const loadId = await draftLoad(s);
      const post = await postWith(s, loadId, {
        strategy: "SELECTED_FIRST",
        carrierCompanyIds: [c.companyId],
        carrierGroupIds: [],
        releases: [],
      });
      expect(post.json().audience.audienceCount).toBe(1);

      await disconnect(s, connId);

      // List visibility removed.
      expect(idsOf(await board(c))).not.toContain(loadId);
      // Detail is privacy-safe — the same 404 as any other hidden load, not
      // a differently-worded 403 that would leak that it was once selected.
      const detailRes = await detail(c, loadId);
      expect(detailRes.statusCode).toBe(404);
      expect(detailRes.json().error.code).not.toBe("FORBIDDEN");
      // Offer creation is independently blocked too.
      expect((await offer(c, loadId)).statusCode).toBe(404);

      // The frozen SELECTED snapshot row is untouched — historical truth survives.
      const snapshotRows = await prisma.loadAudienceMember.findMany({
        where: { loadId, carrierCompanyId: c.companyId, stage: "SELECTED" },
      });
      expect(snapshotRows).toHaveLength(1);

      // The historical connection-lifecycle event log is untouched too —
      // the disconnect is recorded, not erased or rewritten.
      const events = await prisma.companyConnectionEvent.findMany({ where: { connectionId: connId } });
      expect(events.map((e) => e.type)).toEqual(["REQUESTED", "ACCEPTED", "DISCONNECTED"]);
    });

    it("reconnecting restores visibility while the load remains eligible — the SAME unchanged snapshot, current authorization true again", async () => {
      const s = await shipper();
      const c = await carrier("Selected Then Reconnected");
      const connId = await connected(s, c);
      const loadId = await draftLoad(s);
      await postWith(s, loadId, {
        strategy: "SELECTED_FIRST",
        carrierCompanyIds: [c.companyId],
        carrierGroupIds: [],
        releases: [],
      });

      await disconnect(s, connId);
      expect(idsOf(await board(c))).not.toContain(loadId);

      const snapshotBefore = await prisma.loadAudienceMember.findMany({
        where: { loadId, carrierCompanyId: c.companyId, stage: "SELECTED" },
      });

      await reconnect(s, c);
      expect(idsOf(await board(c))).toContain(loadId);
      expect((await detail(c, loadId)).statusCode).toBe(200);

      // Still the exact same snapshot row — reconnect never re-writes it.
      const snapshotAfter = await prisma.loadAudienceMember.findMany({
        where: { loadId, carrierCompanyId: c.companyId, stage: "SELECTED" },
      });
      expect(snapshotAfter).toHaveLength(1);
      const before = snapshotBefore[0]!;
      const after = snapshotAfter[0]!;
      expect(after.id).toBe(before.id);
      expect(after.createdAt).toEqual(before.createdAt);
    });
  });

  // ── GROUP SNAPSHOT ──────────────────────────────────────────────

  describe("Carrier Group audience snapshot", () => {
    it("editing the group after posting never changes the already-posted audience", async () => {
      const s = await shipper();
      const a = await carrier("Carrier A");
      const b = await carrier("Carrier B");
      const d = await carrier("Carrier D");
      await connected(s, a);
      await connected(s, b);
      await connected(s, d);

      const groupRes = await api.inject(
        authed(s.cookie, { method: "POST", url: "/api/carrier-groups", payload: { name: "Texas Core" } }),
      );
      const groupId = groupRes.json().id;
      for (const member of [a, b]) {
        await api.inject(
          authed(s.cookie, {
            method: "POST",
            url: `/api/carrier-groups/${groupId}/members`,
            payload: { carrierCompanyId: member.companyId },
          }),
        );
      }

      const loadId = await draftLoad(s);
      const post = await postWith(s, loadId, {
        strategy: "SELECTED_FIRST",
        carrierCompanyIds: [],
        carrierGroupIds: [groupId],
        releases: [],
      });
      expect(post.statusCode).toBe(200);
      expect(post.json().audience.audienceCount).toBe(2); // A, B

      // Edit the group AFTER posting: remove B, add D.
      await api.inject(
        authed(s.cookie, {
          method: "DELETE",
          url: `/api/carrier-groups/${groupId}/members/${b.companyId}`,
        }),
      );
      await api.inject(
        authed(s.cookie, {
          method: "POST",
          url: `/api/carrier-groups/${groupId}/members`,
          payload: { carrierCompanyId: d.companyId },
        }),
      );

      // The posted load's audience remains exactly A, B — never A, D.
      expect(idsOf(await board(a))).toContain(loadId);
      expect(idsOf(await board(b))).toContain(loadId);
      expect(idsOf(await board(d))).not.toContain(loadId);
    });
  });

  // ── TIMED RELEASE ───────────────────────────────────────────────

  describe("timed release", () => {
    it("widens from Selected to Marketplace at the scheduled time, preserving the same Load id/reference and existing offers", async () => {
      const s = await shipper();
      const selected = await carrier("Early Carrier");
      const late = await carrier("Late Carrier");
      await connected(s, selected);

      const loadId = await draftLoad(s);
      const before = await api.inject(authed(s.cookie, { method: "GET", url: `/api/loads/${loadId}` }));
      const referenceNumber = before.json().referenceNumber;

      const releaseAt = new Date(Date.now() + 1000).toISOString();
      const post = await postWith(s, loadId, {
        strategy: "SELECTED_FIRST",
        carrierCompanyIds: [selected.companyId],
        carrierGroupIds: [],
        releases: [{ toStage: "MARKETPLACE", releaseAt }],
      });
      expect(post.statusCode).toBe(200);

      // Restricted before release.
      expect(idsOf(await board(late))).not.toContain(loadId);

      const offerRes = await offer(selected, loadId, "1200.00");
      expect(offerRes.statusCode).toBe(201);

      // Simulate the poller ticking after the scheduled time.
      await processDueReleases(prisma, { now: new Date(Date.now() + 2000) });

      // Broader after release — same Load id/reference.
      const afterList = idsOf(await board(late));
      expect(afterList).toContain(loadId);
      const afterView = await api.inject(authed(s.cookie, { method: "GET", url: `/api/loads/${loadId}` }));
      expect(afterView.json().id).toBe(loadId);
      expect(afterView.json().referenceNumber).toBe(referenceNumber);
      expect(afterView.json().audience.currentStage).toBe("MARKETPLACE");

      // The existing offer survived the audience expansion.
      const threads = await api.inject(
        authed(s.cookie, { method: "GET", url: `/api/loads/${loadId}/offers` }),
      );
      expect(threads.json().data).toHaveLength(1);

      // Exactly one LOAD_RELEASED_TO_MARKETPLACE event.
      const releasedEvents = afterView
        .json()
        .events.filter((e: { type: string }) => e.type === "LOAD_RELEASED_TO_MARKETPLACE");
      expect(releasedEvents).toHaveLength(1);
    });

    it("a duplicate poll execution is idempotent — the release applies exactly once", async () => {
      const s = await shipper();
      const netCarrier = await carrier();
      await connected(s, netCarrier);
      const loadId = await draftLoad(s);
      const releaseAt = new Date(Date.now() + 1000).toISOString();
      await postWith(s, loadId, { strategy: "NETWORK_FIRST", releases: [{ toStage: "MARKETPLACE", releaseAt }] });

      const now = new Date(Date.now() + 2000);
      const [r1, r2] = await Promise.all([
        processDueReleases(prisma, { now }),
        processDueReleases(prisma, { now }),
      ]);
      // Across both concurrent ticks, exactly one actually released it.
      expect(r1.released + r2.released).toBe(1);

      const view = await api.inject(authed(s.cookie, { method: "GET", url: `/api/loads/${loadId}` }));
      expect(view.json().audience.currentStage).toBe("MARKETPLACE");
      const releasedEvents = view
        .json()
        .events.filter((e: { type: string }) => e.type === "LOAD_RELEASED_TO_MARKETPLACE");
      expect(releasedEvents).toHaveLength(1);
    });
  });

  // ── Review correction #2: a Selected -> Network release FREEZES the
  // Network audience at the moment it actually executes — resolved fresh
  // from current connections at that instant, then never rewritten by
  // later network changes. ──

  describe("Selected -> Network release freezes the audience at execution time", () => {
    it("resolves and freezes currently-eligible connected carriers at the moment the Network release executes", async () => {
      const s = await shipper();
      const selected = await carrier("Selected Origin");
      const networkOnly = await carrier("Network Only At Release");
      await connected(s, selected);
      // Connected to the shipper but NOT part of the original Selected pick —
      // still eligible for the Network snapshot once that stage executes.
      await connected(s, networkOnly);

      const loadId = await draftLoad(s);
      const releaseAt = new Date(Date.now() + 1000).toISOString();
      const post = await postWith(s, loadId, {
        strategy: "SELECTED_FIRST",
        carrierCompanyIds: [selected.companyId],
        carrierGroupIds: [],
        releases: [{ toStage: "NETWORK", releaseAt }],
      });
      expect(post.statusCode).toBe(200);
      expect(post.json().audience.currentStage).toBe("SELECTED");

      // Before release: only the originally selected carrier sees it.
      expect(idsOf(await board(networkOnly))).not.toContain(loadId);

      await processDueReleases(prisma, { now: new Date(Date.now() + 2000) });

      const afterRelease = await api.inject(
        authed(s.cookie, { method: "GET", url: `/api/loads/${loadId}` }),
      );
      expect(afterRelease.json().audience.currentStage).toBe("NETWORK");

      // After release: the whole currently-connected network sees it,
      // including a carrier who was never part of the original selection.
      expect(idsOf(await board(selected))).toContain(loadId);
      expect(idsOf(await board(networkOnly))).toContain(loadId);

      const networkSnapshot = await prisma.loadAudienceMember.findMany({
        where: { loadId, stage: "NETWORK" },
      });
      expect(networkSnapshot.map((m) => m.carrierCompanyId).sort()).toEqual(
        [selected.companyId, networkOnly.companyId].sort(),
      );
    });

    it("network changes AFTER that release never mutate the already-frozen Network snapshot", async () => {
      const s = await shipper();
      const selected = await carrier("Frozen Selected");
      const networkAtRelease = await carrier("Frozen Network Member");
      await connected(s, selected);
      await connected(s, networkAtRelease);

      const loadId = await draftLoad(s);
      const releaseAt = new Date(Date.now() + 1000).toISOString();
      await postWith(s, loadId, {
        strategy: "SELECTED_FIRST",
        carrierCompanyIds: [selected.companyId],
        carrierGroupIds: [],
        releases: [{ toStage: "NETWORK", releaseAt }],
      });
      await processDueReleases(prisma, { now: new Date(Date.now() + 2000) });

      const snapshotBefore = await prisma.loadAudienceMember.findMany({
        where: { loadId, stage: "NETWORK" },
        select: { carrierCompanyId: true },
      });

      // Connect a brand-new carrier to the shipper's network AFTER the
      // Network release already executed.
      const lateJoiner = await carrier("Joined After Network Release");
      await connected(s, lateJoiner);

      expect(idsOf(await board(lateJoiner))).not.toContain(loadId);

      const snapshotAfter = await prisma.loadAudienceMember.findMany({
        where: { loadId, stage: "NETWORK" },
        select: { carrierCompanyId: true },
      });
      expect(snapshotAfter.map((m) => m.carrierCompanyId).sort()).toEqual(
        snapshotBefore.map((m) => m.carrierCompanyId).sort(),
      );
    });
  });

  // ── Review correction #3: chained release ordering is DATABASE-enforced
  // (each release's own `fromStage`), never dependent on process-local
  // order, a single poller instance, or poll timing. ──

  describe("chained release ordering is multi-instance safe", () => {
    it("attempting the Marketplace hop before its Network predecessor never advances the load; the predecessor then executes; Marketplace then executes correctly", async () => {
      const s = await shipper();
      const selected = await carrier("Chain Selected");
      const networkCarrier = await carrier("Chain Network Member");
      await connected(s, selected);
      await connected(s, networkCarrier);

      const loadId = await draftLoad(s);
      const networkAt = new Date(Date.now() + 1000).toISOString();
      const marketplaceAt = new Date(Date.now() + 2000).toISOString();
      const post = await postWith(s, loadId, {
        strategy: "SELECTED_FIRST",
        carrierCompanyIds: [selected.companyId],
        carrierGroupIds: [],
        releases: [
          { toStage: "NETWORK", releaseAt: networkAt },
          { toStage: "MARKETPLACE", releaseAt: marketplaceAt },
        ],
      });
      expect(post.statusCode).toBe(200);
      const [networkReleaseId, marketplaceReleaseId] = post
        .json()
        .audience.pendingReleases.map((r: { id: string }) => r.id);

      const now = new Date(Date.now() + 3000); // both rows are now "due"

      // Deliberately attempt the LATER (Marketplace) hop FIRST — simulating
      // a misordered / multi-instance execution.
      const marketplaceAttempt1 = await executeOneRelease(prisma, marketplaceReleaseId, now);
      expect(marketplaceAttempt1).toBe("skipped"); // predecessor hasn't run — must NOT advance

      let midState = await api.inject(authed(s.cookie, { method: "GET", url: `/api/loads/${loadId}` }));
      expect(midState.json().audience.currentStage).toBe("SELECTED"); // unchanged

      const marketplaceRowMid = await prisma.loadAudienceRelease.findUniqueOrThrow({
        where: { id: marketplaceReleaseId },
      });
      expect(marketplaceRowMid.status).toBe("PENDING"); // left retryable, not consumed/cancelled

      // Now the Network predecessor executes.
      const networkOutcome = await executeOneRelease(prisma, networkReleaseId, now);
      expect(networkOutcome).toBe("released");

      midState = await api.inject(authed(s.cookie, { method: "GET", url: `/api/loads/${loadId}` }));
      expect(midState.json().audience.currentStage).toBe("NETWORK");

      // Marketplace, retried, now executes correctly.
      const marketplaceAttempt2 = await executeOneRelease(prisma, marketplaceReleaseId, now);
      expect(marketplaceAttempt2).toBe("released");

      const finalState = await api.inject(
        authed(s.cookie, { method: "GET", url: `/api/loads/${loadId}` }),
      );
      expect(finalState.json().audience.currentStage).toBe("MARKETPLACE");

      // Event order is correct and no event is duplicated.
      const releaseEvents = finalState
        .json()
        .events.filter((e: { type: string }) =>
          ["LOAD_RELEASED_TO_NETWORK", "LOAD_RELEASED_TO_MARKETPLACE"].includes(e.type),
        );
      expect(releaseEvents.map((e: { type: string }) => e.type)).toEqual([
        "LOAD_RELEASED_TO_NETWORK",
        "LOAD_RELEASED_TO_MARKETPLACE",
      ]);

      // No release row was lost — both are RELEASED exactly once.
      const finalRows = await prisma.loadAudienceRelease.findMany({ where: { loadId } });
      expect(finalRows).toHaveLength(2);
      expect(finalRows.every((r) => r.status === "RELEASED")).toBe(true);

      // The freight remained visible to the network carrier throughout the
      // whole sequence once actually released — same Load, correct outcome.
      expect(idsOf(await board(networkCarrier))).toContain(loadId);
    });
  });

  // ── AWARD RACE ──────────────────────────────────────────────────

  describe("award race", () => {
    it("a mere received offer does not cancel a pending release", async () => {
      const s = await shipper();
      const c = await carrier();
      await connected(s, c);
      const loadId = await draftLoad(s);
      const releaseAt = new Date(Date.now() + 60_000).toISOString();
      await postWith(s, loadId, { strategy: "NETWORK_FIRST", releases: [{ toStage: "MARKETPLACE", releaseAt }] });

      await offer(c, loadId, "1300.00");

      const view = await api.inject(authed(s.cookie, { method: "GET", url: `/api/loads/${loadId}` }));
      expect(view.json().audience.pendingReleases).toHaveLength(1);
      expect(view.json().audience.pendingReleases[0].status).toBe("PENDING");
    });

    it("an accepted/awarded offer cancels the pending release, and a later poll cannot widen the audience", async () => {
      const s = await shipper();
      const c = await carrier();
      const other = await carrier("Other Carrier");
      await connected(s, c);
      const loadId = await draftLoad(s);
      const releaseAt = new Date(Date.now() + 1000).toISOString();
      await postWith(s, loadId, { strategy: "NETWORK_FIRST", releases: [{ toStage: "MARKETPLACE", releaseAt }] });

      const offerRes = await offer(c, loadId, "1400.00");
      const roundId = offerRes.json().rounds[0].id;
      const accept = await api.inject(
        authed(s.cookie, { method: "POST", url: `/api/offers/rounds/${roundId}/accept` }),
      );
      expect(accept.statusCode).toBe(200);

      const afterAward = await api.inject(
        authed(s.cookie, { method: "GET", url: `/api/loads/${loadId}` }),
      );
      expect(afterAward.json().audience.pendingReleases).toHaveLength(0);

      // The execution path itself re-checks state: even if a poll runs late,
      // it must not widen a now-AWARDED load's audience.
      const result = await processDueReleases(prisma, { now: new Date(Date.now() + 2000) });
      expect(result.released).toBe(0);

      expect(idsOf(await board(other))).not.toContain(loadId);
    });
  });

  // ── MANUAL RELEASE ──────────────────────────────────────────────

  describe("manual release (Release Now)", () => {
    it("releases immediately and preserves existing offers; a second Release Now is harmless", async () => {
      const s = await shipper();
      const selected = await carrier("Selected Now");
      const other = await carrier("Other Now");
      await connected(s, selected);
      const loadId = await draftLoad(s);
      await postWith(s, loadId, {
        strategy: "SELECTED_FIRST",
        carrierCompanyIds: [selected.companyId],
        carrierGroupIds: [],
        releases: [],
      });
      await offer(selected, loadId, "1600.00");

      const releaseNow = await api.inject(
        authed(s.cookie, {
          method: "POST",
          url: `/api/loads/${loadId}/release-now`,
          payload: { target: "MARKETPLACE" },
        }),
      );
      expect(releaseNow.statusCode).toBe(200);
      expect(idsOf(await board(other))).toContain(loadId);

      const threads = await api.inject(
        authed(s.cookie, { method: "GET", url: `/api/loads/${loadId}/offers` }),
      );
      expect(threads.json().data).toHaveLength(1);

      // A second Release Now to the SAME (already-reached) stage is rejected
      // cleanly — not a silent double-widen, not a crash.
      const again = await api.inject(
        authed(s.cookie, {
          method: "POST",
          url: `/api/loads/${loadId}/release-now`,
          payload: { target: "MARKETPLACE" },
        }),
      );
      expect(again.statusCode).toBe(409);
    });
  });

  // ── RESCHEDULE / CANCEL ─────────────────────────────────────────

  describe("reschedule and cancel", () => {
    it("a pending release can be rescheduled while eligible, and the change is recorded", async () => {
      const s = await shipper();
      const c = await carrier();
      await connected(s, c);
      const loadId = await draftLoad(s);
      const firstAt = new Date(Date.now() + 3_600_000).toISOString();
      const post = await postWith(s, loadId, {
        strategy: "NETWORK_FIRST",
        releases: [{ toStage: "MARKETPLACE", releaseAt: firstAt }],
      });
      const releaseId = post.json().audience.pendingReleases[0].id;

      const newAt = new Date(Date.now() + 7_200_000).toISOString();
      const resched = await api.inject(
        authed(s.cookie, {
          method: "POST",
          url: `/api/loads/${loadId}/audience-releases/${releaseId}/reschedule`,
          payload: { releaseAt: newAt },
        }),
      );
      expect(resched.statusCode).toBe(200);
      expect(resched.json().audience.pendingReleases[0].scheduledAt).toBe(newAt);
      const rescheduledEvents = resched
        .json()
        .events.filter((e: { type: string }) => e.type === "RELEASE_RESCHEDULED");
      expect(rescheduledEvents).toHaveLength(1);
    });

    it("cancelling a pending release prevents automatic widening and retains an audit event", async () => {
      const s = await shipper();
      const c = await carrier();
      const other = await carrier("Other Cancel");
      await connected(s, c);
      const loadId = await draftLoad(s);
      const releaseAt = new Date(Date.now() + 1000).toISOString();
      const post = await postWith(s, loadId, {
        strategy: "NETWORK_FIRST",
        releases: [{ toStage: "MARKETPLACE", releaseAt }],
      });
      const releaseId = post.json().audience.pendingReleases[0].id;

      const cancel = await api.inject(
        authed(s.cookie, {
          method: "POST",
          url: `/api/loads/${loadId}/audience-releases/${releaseId}/cancel`,
        }),
      );
      expect(cancel.statusCode).toBe(200);
      expect(cancel.json().audience.autoReleaseDisabled).toBe(true);
      expect(cancel.json().audience.pendingReleases).toHaveLength(0);
      const cancelledEvents = cancel
        .json()
        .events.filter((e: { type: string }) => e.type === "RELEASE_CANCELLED");
      expect(cancelledEvents).toHaveLength(1);

      // The poller can no longer widen it — nothing PENDING remains.
      await processDueReleases(prisma, { now: new Date(Date.now() + 2000) });
      expect(idsOf(await board(other))).not.toContain(loadId);
    });
  });

  // ── PRIVACY / IDOR ──────────────────────────────────────────────

  describe("privacy / IDOR", () => {
    it("a carrier outside the audience gets the same 404 as a nonexistent load — no differently-worded 403", async () => {
      const s = await shipper();
      const outsider = await carrier();
      const selectedOnly = await carrier("Selected Only");
      await connected(s, selectedOnly);
      const loadId = await draftLoad(s);
      await postWith(s, loadId, {
        strategy: "SELECTED_FIRST",
        carrierCompanyIds: [selectedOnly.companyId],
        carrierGroupIds: [],
        releases: [],
      });

      const res = await detail(outsider, loadId);
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).not.toBe("FORBIDDEN");
    });

    it("the offer-creation endpoint independently rechecks audience — a known Load ID is not enough", async () => {
      const s = await shipper();
      const selected = await carrier("Selected For Offer");
      const outsider = await carrier("Knows The Id");
      await connected(s, selected);
      await connected(s, outsider);
      const loadId = await draftLoad(s);
      await postWith(s, loadId, {
        strategy: "SELECTED_FIRST",
        carrierCompanyIds: [selected.companyId],
        carrierGroupIds: [],
        releases: [],
      });

      // The outsider is connected (so NOT globally blind to the shipper) but
      // was never selected for THIS load — offer creation must still refuse.
      const res = await offer(outsider, loadId, "1000.00");
      expect(res.statusCode).toBe(404);
    });
  });

  // ── REPOST (unpost -> edit -> post again) ─────────────────────────
  //
  // Phase 4 hotfix: a repost must never inherit mutable audience execution
  // state (strategy record, member snapshot, pending/executed releases)
  // from a PRIOR posting of the SAME load — see
  // audience.service.ts#applyAudienceAtPosting.

  describe("unpost -> edit -> repost", () => {
    it("reposting with the SAME (Marketplace) strategy succeeds — no unique-constraint failure", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await draftLoad(s);

      expect((await postWith(s, loadId, { strategy: "MARKETPLACE" })).statusCode).toBe(200);
      expect((await unpost(s, loadId)).statusCode).toBe(200);
      expect((await editLoad(s, loadId, { commodity: "Repost test commodity" })).statusCode).toBe(200);

      const repost = await postWith(s, loadId, { strategy: "MARKETPLACE" });
      expect(repost.statusCode).toBe(200);
      expect(repost.json().status).toBe("POSTED");
      expect(repost.json().audience).toEqual(
        expect.objectContaining({ strategy: "MARKETPLACE", currentStage: "MARKETPLACE" }),
      );
      expect(idsOf(await board(c))).toContain(loadId);

      // Exactly one strategy row ever exists for this load at a time.
      const strategies = await prisma.loadAudienceStrategyRecord.findMany({ where: { loadId } });
      expect(strategies).toHaveLength(1);
    });

    it("reposting with the SAME (Selected Carriers First) strategy succeeds and re-establishes a fresh snapshot", async () => {
      const s = await shipper();
      const selected = await carrier("Reposted Selected Carrier");
      await connected(s, selected);
      const loadId = await draftLoad(s);

      await postWith(s, loadId, {
        strategy: "SELECTED_FIRST",
        carrierCompanyIds: [selected.companyId],
        carrierGroupIds: [],
        releases: [],
      });
      expect((await unpost(s, loadId)).statusCode).toBe(200);
      expect((await editLoad(s, loadId, { commodity: "Repost test commodity 2" })).statusCode).toBe(200);

      const repost = await postWith(s, loadId, {
        strategy: "SELECTED_FIRST",
        carrierCompanyIds: [selected.companyId],
        carrierGroupIds: [],
        releases: [],
      });
      expect(repost.statusCode).toBe(200);
      expect(repost.json().audience.currentStage).toBe("SELECTED");
      expect(repost.json().audience.audienceCount).toBe(1);
      expect(idsOf(await board(selected))).toContain(loadId);

      const strategies = await prisma.loadAudienceStrategyRecord.findMany({ where: { loadId } });
      expect(strategies).toHaveLength(1);
    });

    it("reposting with a DIFFERENT strategy makes the new strategy authoritative", async () => {
      const s = await shipper();
      const selected = await carrier("Selected Then Reposted Open");
      const outsider = await carrier("Never Selected, Never Connected");
      await connected(s, selected);
      const loadId = await draftLoad(s);

      await postWith(s, loadId, {
        strategy: "SELECTED_FIRST",
        carrierCompanyIds: [selected.companyId],
        carrierGroupIds: [],
        releases: [],
      });
      expect(idsOf(await board(outsider))).not.toContain(loadId);

      expect((await unpost(s, loadId)).statusCode).toBe(200);
      expect((await editLoad(s, loadId, { commodity: "Now going to Marketplace" })).statusCode).toBe(200);

      const repost = await postWith(s, loadId, { strategy: "MARKETPLACE" });
      expect(repost.statusCode).toBe(200);
      expect(repost.json().audience).toEqual(
        expect.objectContaining({ strategy: "MARKETPLACE", currentStage: "MARKETPLACE" }),
      );

      // A carrier who was never selected and never connected is now visible —
      // proof the NEW strategy, not the old private one, is authoritative.
      expect(idsOf(await board(outsider))).toContain(loadId);
    });

    it("a stale posting #1 selected-carrier snapshot never grants access under posting #2 — replaced, not merged", async () => {
      const s = await shipper();
      const a = await carrier("Selected Posting 1 - A");
      const b = await carrier("Selected Posting 1 - B");
      const cNew = await carrier("Selected Posting 2 - C");
      await connected(s, a);
      await connected(s, b);
      await connected(s, cNew);
      const loadId = await draftLoad(s);

      await postWith(s, loadId, {
        strategy: "SELECTED_FIRST",
        carrierCompanyIds: [a.companyId, b.companyId],
        carrierGroupIds: [],
        releases: [],
      });
      expect(idsOf(await board(a))).toContain(loadId);
      expect(idsOf(await board(b))).toContain(loadId);

      expect((await unpost(s, loadId)).statusCode).toBe(200);
      expect((await editLoad(s, loadId, { commodity: "Reselected audience" })).statusCode).toBe(200);

      const repost = await postWith(s, loadId, {
        strategy: "SELECTED_FIRST",
        carrierCompanyIds: [cNew.companyId],
        carrierGroupIds: [],
        releases: [],
      });
      expect(repost.statusCode).toBe(200);
      expect(repost.json().audience.audienceCount).toBe(1);

      // A and B — selected under posting #1 — are NOT authorized under
      // posting #2's fresh snapshot, even though they remain connected.
      expect(idsOf(await board(a))).not.toContain(loadId);
      expect(idsOf(await board(b))).not.toContain(loadId);
      expect((await detail(a, loadId)).statusCode).toBe(404);
      expect((await detail(b, loadId)).statusCode).toBe(404);
      expect((await offer(a, loadId)).statusCode).toBe(404);

      // C — selected under posting #2 — is authorized.
      expect(idsOf(await board(cNew))).toContain(loadId);
      expect((await detail(cNew, loadId)).statusCode).toBe(200);

      // No stray SELECTED-stage member row survives for A/B under this load —
      // the old strategy (and its snapshot) was replaced, not merely shadowed.
      const staleMembers = await prisma.loadAudienceMember.findMany({
        where: { loadId, carrierCompanyId: { in: [a.companyId, b.companyId] } },
      });
      expect(staleMembers).toHaveLength(0);

      // No private identity leak in the new-audience carrier's own view.
      const view = await detail(cNew, loadId);
      expect(JSON.stringify(view.json())).not.toContain(a.companyId);
      expect(JSON.stringify(view.json())).not.toContain(b.companyId);
    });

    it("a scheduled release from posting #1 can never execute against posting #2 (critical regression)", async () => {
      const s = await shipper();
      const selected = await carrier("Posting 1 Selected");
      const outsider = await carrier("Would-be Early Release Beneficiary");
      await connected(s, selected);
      const loadId = await draftLoad(s);

      const releaseAt = new Date(Date.now() + 60_000).toISOString();
      const post1 = await postWith(s, loadId, {
        strategy: "SELECTED_FIRST",
        carrierCompanyIds: [selected.companyId],
        carrierGroupIds: [],
        releases: [{ toStage: "MARKETPLACE", releaseAt }],
      });
      expect(post1.statusCode).toBe(200);
      const staleReleaseId = post1.json().audience.pendingReleases[0].id;

      expect((await unpost(s, loadId)).statusCode).toBe(200);
      expect((await editLoad(s, loadId, { commodity: "Repost, no auto release" })).statusCode).toBe(200);

      // Posting #2: same private strategy, no scheduled widening this time.
      const post2 = await postWith(s, loadId, {
        strategy: "SELECTED_FIRST",
        carrierCompanyIds: [selected.companyId],
        carrierGroupIds: [],
        releases: [],
      });
      expect(post2.statusCode).toBe(200);
      expect(post2.json().audience.pendingReleases).toHaveLength(0);

      // The row itself is gone — it can never be claimed, retried, or
      // accidentally re-associated with posting #2's strategy.
      const staleRow = await prisma.loadAudienceRelease.findUnique({ where: { id: staleReleaseId } });
      expect(staleRow).toBeNull();

      // Directly attempting to execute the stale release id (simulating a
      // release-engine poll tick that queued it before the repost committed)
      // safely no-ops rather than widening posting #2's audience.
      const outcome = await executeOneRelease(prisma, staleReleaseId, new Date(Date.now() + 120_000));
      expect(outcome).toBe("skipped");

      // Posting #2 never widened — the outsider still has no access.
      expect(idsOf(await board(outsider))).not.toContain(loadId);
      const finalState = await api.inject(
        authed(s.cookie, { method: "GET", url: `/api/loads/${loadId}` }),
      );
      expect(finalState.json().audience.currentStage).toBe("SELECTED");

      // Posting #1's own scheduling fact remains in the immutable event log.
      const events = await prisma.loadEvent.findMany({ where: { loadId }, orderBy: { createdAt: "asc" } });
      expect(events.some((e) => e.type === "MARKETPLACE_RELEASE_SCHEDULED")).toBe(true);
    });

    it("a failed repost (empty resulting audience) rolls back cleanly — the prior posting's state is untouched", async () => {
      const s = await shipper();
      const selected = await carrier("Posting 1 Valid Selection");
      const neverConnected = await carrier("Never Connected For Posting 2");
      await connected(s, selected);
      const loadId = await draftLoad(s);

      await postWith(s, loadId, {
        strategy: "SELECTED_FIRST",
        carrierCompanyIds: [selected.companyId],
        carrierGroupIds: [],
        releases: [],
      });
      const strategyBefore = await prisma.loadAudienceStrategyRecord.findUniqueOrThrow({
        where: { loadId },
      });

      expect((await unpost(s, loadId)).statusCode).toBe(200);
      expect((await editLoad(s, loadId, { commodity: "Attempting invalid repost" })).statusCode).toBe(200);

      // This repost attempt has zero eligible carriers — must be rejected,
      // and must not partially apply (no delete-without-recreate).
      const failedRepost = await postWith(s, loadId, {
        strategy: "SELECTED_FIRST",
        carrierCompanyIds: [neverConnected.companyId],
        carrierGroupIds: [],
        releases: [],
      });
      expect(failedRepost.statusCode).toBe(409);

      const loadAfterFailure = await prisma.load.findUniqueOrThrow({ where: { id: loadId } });
      expect(loadAfterFailure.status).toBe("DRAFT"); // never partially posted

      // The PRIOR posting's strategy row survived the failed attempt intact
      // — the delete-then-create for posting #2 never committed.
      const strategyAfterFailure = await prisma.loadAudienceStrategyRecord.findUniqueOrThrow({
        where: { loadId },
      });
      expect(strategyAfterFailure.id).toBe(strategyBefore.id);
      expect(strategyAfterFailure.strategy).toBe("SELECTED_FIRST");

      // A subsequent VALID repost still succeeds — no lingering corruption.
      const validRepost = await postWith(s, loadId, {
        strategy: "SELECTED_FIRST",
        carrierCompanyIds: [selected.companyId],
        carrierGroupIds: [],
        releases: [],
      });
      expect(validRepost.statusCode).toBe(200);
      expect(idsOf(await board(selected))).toContain(loadId);
    });
  });

  // ── HISTORICAL COMPATIBILITY ─────────────────────────────────────

  describe("historical compatibility", () => {
    it("a pre-Phase-4 posted load (no recorded strategy) remains fully marketplace-visible", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await draftLoad(s);
      await postWith(s, loadId, { strategy: "MARKETPLACE" });

      // Simulate a load posted before this feature existed: strip the
      // strategy row a real historical load would never have had.
      await prisma.loadAudienceStrategyRecord.delete({ where: { loadId } });

      const view = await api.inject(authed(s.cookie, { method: "GET", url: `/api/loads/${loadId}` }));
      expect(view.json().audience).toBeNull();

      expect(idsOf(await board(c))).toContain(loadId);
      expect((await detail(c, loadId)).statusCode).toBe(200);
    });
  });
});
