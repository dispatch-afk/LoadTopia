import type { PrismaClient } from "@loadtopia/db";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addNonPrimaryMember,
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

suite("relationship network (M4 Phase 2, integration)", () => {
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

  async function shipperCo(name = "Acme Manufacturing"): Promise<Session> {
    return registerCompany(api, { type: "SHIPPER", companyName: name });
  }
  async function carrierCo(name = "Longhorn Transportation"): Promise<Session> {
    return registerCompany(api, { type: "CARRIER", companyName: name });
  }

  /** A second, NON-PRIMARY member of an existing company. */
  async function ordinaryMember(
    primary: Session,
    role: "SHIPPER" | "CARRIER",
    label: string,
  ): Promise<string> {
    const throwaway = await registerCompany(api, { type: role, companyName: `throwaway-${label}` });
    return addNonPrimaryMember(api, primary.cookie, primary.companyId, {
      email: throwaway.email,
      role,
    });
  }

  async function requestConnection(from: Session, toCompanyId: string) {
    return api.inject(
      authed(from.cookie, { method: "POST", url: `/api/companies/${toCompanyId}/connections` }),
    );
  }
  async function acceptConnection(actorCookie: string, connectionId: string) {
    return api.inject(
      authed(actorCookie, { method: "POST", url: `/api/connections/${connectionId}/accept` }),
    );
  }
  async function getConnection(actorCookie: string, connectionId: string) {
    return api.inject(authed(actorCookie, { method: "GET", url: `/api/connections/${connectionId}` }));
  }

  /** Full request+accept cycle between a shipper and a carrier, returning
   *  the connection id. */
  async function connected(shipper: Session, carrier: Session): Promise<string> {
    const req = await requestConnection(shipper, carrier.companyId);
    expect(req.statusCode).toBe(201);
    const connectionId = req.json().id;
    const accept = await acceptConnection(carrier.cookie, connectionId);
    expect(accept.statusCode).toBe(200);
    return connectionId;
  }

  async function awardedLoad(shipper: Session, carrier: Session): Promise<string> {
    const origin = await createLocation(api, shipper.cookie, { city: "Chicago", state: "IL" });
    const dest = await createLocation(api, shipper.cookie, { city: "Dallas", state: "TX" });
    const draft = await api.inject(
      authed(shipper.cookie, {
        method: "POST",
        url: "/api/loads",
        payload: {
          originLocationId: origin,
          destinationLocationId: dest,
          equipmentType: "DRY_VAN",
          mode: "FTL",
          commodity: "Palletized dry goods",
          weightLbs: 30000,
          pickupWindowStart: future(3, 8),
          pickupWindowEnd: future(3, 16),
          deliveryWindowStart: future(5, 8),
          deliveryWindowEnd: future(5, 17),
        },
      }),
    );
    if (draft.statusCode !== 201) throw new Error(`draft load ${draft.statusCode}: ${draft.body}`);
    const loadId = draft.json().id;
    const post = await api.inject(
      authed(shipper.cookie, { method: "POST", url: `/api/loads/${loadId}/post` }),
    );
    if (post.statusCode !== 200) throw new Error(`post load ${post.statusCode}: ${post.body}`);
    const profile = await api.inject(
      authed(carrier.cookie, {
        method: "PUT",
        url: "/api/carrier/profile",
        payload: { legalName: "Longhorn Transportation LLC", equipmentTypes: [], serviceAreaStates: [] },
      }),
    );
    if (profile.statusCode !== 200) throw new Error(`carrier profile ${profile.statusCode}: ${profile.body}`);
    await prisma.carrierProfile.update({
      where: { companyId: carrier.companyId },
      data: { marketplaceEligibility: "ELIGIBLE", verificationStatus: "VERIFIED" },
    });
    const offer = await api.inject(
      authed(carrier.cookie, {
        method: "POST",
        url: `/api/marketplace/loads/${loadId}/offers`,
        payload: { amount: "1800.00", currency: "USD" },
      }),
    );
    if (offer.statusCode !== 201) throw new Error(`offer ${offer.statusCode}: ${offer.body}`);
    const roundId = offer.json().rounds[0].id;
    const accept = await api.inject(
      authed(shipper.cookie, { method: "POST", url: `/api/offers/rounds/${roundId}/accept` }),
    );
    expect(accept.statusCode).toBe(200);
    return loadId;
  }

  // ── FOLLOW ──────────────────────────────────────────────────────────

  describe("Follow", () => {
    it("a carrier follows a shipper", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      const res = await api.inject(
        authed(c.cookie, { method: "POST", url: `/api/companies/${s.companyId}/follow` }),
      );
      expect(res.statusCode).toBe(201);
      expect(res.json().shipperCompanyId).toBe(s.companyId);

      const rows = await prisma.carrierFollow.findMany({
        where: { carrierCompanyId: c.companyId, shipperCompanyId: s.companyId },
      });
      expect(rows).toHaveLength(1);
    });

    it("a duplicate follow is idempotent — never a second row", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      await api.inject(authed(c.cookie, { method: "POST", url: `/api/companies/${s.companyId}/follow` }));
      const second = await api.inject(
        authed(c.cookie, { method: "POST", url: `/api/companies/${s.companyId}/follow` }),
      );
      expect(second.statusCode).toBe(201);
      const rows = await prisma.carrierFollow.findMany({
        where: { carrierCompanyId: c.companyId, shipperCompanyId: s.companyId },
      });
      expect(rows).toHaveLength(1);
    });

    it("unfollow removes the row and is idempotent", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      await api.inject(authed(c.cookie, { method: "POST", url: `/api/companies/${s.companyId}/follow` }));
      const del = await api.inject(
        authed(c.cookie, { method: "DELETE", url: `/api/companies/${s.companyId}/follow` }),
      );
      expect(del.statusCode).toBe(204);
      expect(await prisma.carrierFollow.count()).toBe(0);

      const delAgain = await api.inject(
        authed(c.cookie, { method: "DELETE", url: `/api/companies/${s.companyId}/follow` }),
      );
      expect(delAgain.statusCode).toBe(204);
    });

    it("the shipper has no visibility into who follows it", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      await api.inject(authed(c.cookie, { method: "POST", url: `/api/companies/${s.companyId}/follow` }));

      const asShipper = await api.inject(authed(s.cookie, { method: "GET", url: "/api/follows" }));
      expect(asShipper.statusCode).toBe(200);
      expect(asShipper.json().data).toEqual([]);
    });
  });

  // ── CONNECTION ────────────────────────────────────────────────────

  describe("Connection", () => {
    it("an active (non-primary) member can request a connection", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      const memberCookie = await ordinaryMember(s, "SHIPPER", "req");
      const res = await api.inject(
        authed(memberCookie, { method: "POST", url: `/api/companies/${c.companyId}/connections` }),
      );
      expect(res.statusCode).toBe(201);
      expect(res.json().status).toBe("PENDING");
    });

    it("an unauthenticated caller cannot request a connection", async () => {
      const c = await carrierCo();
      const res = await api.inject({
        method: "POST",
        url: `/api/companies/${c.companyId}/connections`,
      });
      expect(res.statusCode).toBe(401);
    });

    it("a request creates a PENDING relationship visible to both sides", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      const req = await requestConnection(s, c.companyId);
      expect(req.statusCode).toBe(201);
      const id = req.json().id;

      const asShipper = await getConnection(s.cookie, id);
      const asCarrier = await getConnection(c.cookie, id);
      expect(asShipper.statusCode).toBe(200);
      expect(asCarrier.statusCode).toBe(200);
      expect(asShipper.json().status).toBe("PENDING");
      expect(asShipper.json().awaitingMyResponse).toBe(false);
      expect(asCarrier.json().awaitingMyResponse).toBe(true);
    });

    it("a reverse-direction duplicate request cannot create a second pair", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      const first = await requestConnection(s, c.companyId);
      expect(first.statusCode).toBe(201);

      const reverse = await requestConnection(c, s.companyId);
      expect(reverse.statusCode).toBe(409);

      const rows = await prisma.companyConnection.findMany({
        where: { OR: [{ companyAId: s.companyId }, { companyBId: s.companyId }] },
      });
      expect(rows).toHaveLength(1);
    });

    it("the same-side requester re-requesting a still-pending connection is idempotent", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      const first = await requestConnection(s, c.companyId);
      const second = await requestConnection(s, c.companyId);
      expect(second.statusCode).toBe(201);
      expect(second.json().id).toBe(first.json().id);
      const rows = await prisma.companyConnection.count();
      expect(rows).toBe(1);
    });

    it("company-primary/admin may accept; an ordinary member may not", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      const req = await requestConnection(s, c.companyId);
      const id = req.json().id;

      const ordinaryCarrier = await ordinaryMember(c, "CARRIER", "accept");
      const denied = await acceptConnection(ordinaryCarrier, id);
      expect(denied.statusCode).toBe(403);

      const accepted = await acceptConnection(c.cookie, id);
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json().status).toBe("ACCEPTED");
    });

    it("only the recipient (not the requester) may accept or decline", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      const req = await requestConnection(s, c.companyId);
      const id = req.json().id;
      const selfAccept = await acceptConnection(s.cookie, id);
      expect(selfAccept.statusCode).toBe(403);
    });

    it("decline moves PENDING to DECLINED without exposing a reason field", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      const req = await requestConnection(s, c.companyId);
      const id = req.json().id;
      const decline = await api.inject(
        authed(c.cookie, { method: "POST", url: `/api/connections/${id}/decline` }),
      );
      expect(decline.statusCode).toBe(200);
      expect(decline.json().status).toBe("DECLINED");
      expect(decline.json()).not.toHaveProperty("declineReason");
      expect(decline.json()).not.toHaveProperty("reason");
    });

    it("disconnect moves ACCEPTED to DISCONNECTED", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      const id = await connected(s, c);
      const disconnect = await api.inject(
        authed(s.cookie, { method: "POST", url: `/api/connections/${id}/disconnect` }),
      );
      expect(disconnect.statusCode).toBe(200);
      expect(disconnect.json().status).toBe("DISCONNECTED");
    });

    it("rejects invalid transitions (e.g. disconnecting a never-accepted request)", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      const req = await requestConnection(s, c.companyId);
      const id = req.json().id;
      const disconnect = await api.inject(
        authed(s.cookie, { method: "POST", url: `/api/connections/${id}/disconnect` }),
      );
      expect(disconnect.statusCode).toBe(409);
    });

    it("re-request after DECLINE or DISCONNECT reuses the same row and preserves history", async () => {
      const s = await shipperCo();
      const c = await carrierCo();

      // Cycle 1: request -> decline -> re-request -> accept -> disconnect.
      const req1 = await requestConnection(s, c.companyId);
      const id = req1.json().id;
      await api.inject(authed(c.cookie, { method: "POST", url: `/api/connections/${id}/decline` }));

      const reReq = await requestConnection(c, s.companyId);
      expect(reReq.statusCode).toBe(201);
      expect(reReq.json().id).toBe(id); // SAME row, not a new one
      expect(reReq.json().status).toBe("PENDING");

      const accept = await acceptConnection(s.cookie, id);
      expect(accept.statusCode).toBe(200);

      await api.inject(authed(s.cookie, { method: "POST", url: `/api/connections/${id}/disconnect` }));

      // Re-request again after disconnect.
      const reReq2 = await requestConnection(s, c.companyId);
      expect(reReq2.statusCode).toBe(201);
      expect(reReq2.json().id).toBe(id);

      // Exactly one row for this pair, ever.
      const rows = await prisma.companyConnection.findMany({ where: { id } });
      expect(rows).toHaveLength(1);

      // Full truthful history preserved in the immutable event log.
      const detail = await getConnection(s.cookie, id);
      const types = detail.json().events.map((e: { type: string }) => e.type);
      expect(types).toEqual(["REQUESTED", "DECLINED", "REQUESTED", "ACCEPTED", "DISCONNECTED", "REQUESTED"]);
    });

    it("company_connection_events is append-only at the database level", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      const id = await connected(s, c);
      const event = await prisma.companyConnectionEvent.findFirstOrThrow({ where: { connectionId: id } });
      await expect(
        prisma.companyConnectionEvent.update({ where: { id: event.id }, data: { type: "DECLINED" } }),
      ).rejects.toThrow();
      await expect(
        prisma.companyConnectionEvent.delete({ where: { id: event.id } }),
      ).rejects.toThrow();
    });

    it("an unrelated third company cannot read someone else's connection (404, IDOR-safe)", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      const id = await connected(s, c);
      const stranger = await shipperCo("Stranger Co");
      const res = await getConnection(stranger.cookie, id);
      expect(res.statusCode).toBe(404);
    });
  });

  // ── PREFERENCE ────────────────────────────────────────────────────

  describe("Carrier preference", () => {
    it("company-primary/admin may set a preference on a connected carrier", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      await connected(s, c);
      const res = await api.inject(
        authed(s.cookie, {
          method: "PUT",
          url: `/api/companies/${c.companyId}/preference`,
          payload: { preference: "DO_NOT_PREFER" },
        }),
      );
      expect(res.statusCode).toBe(200);
      expect(res.json().preference).toBe("DO_NOT_PREFER");
    });

    it("an ordinary member is rejected", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      await connected(s, c);
      const ordinary = await ordinaryMember(s, "SHIPPER", "pref");
      const res = await api.inject(
        authed(ordinary, {
          method: "PUT",
          url: `/api/companies/${c.companyId}/preference`,
          payload: { preference: "PREFER" },
        }),
      );
      expect(res.statusCode).toBe(403);
    });

    it("requires an ACCEPTED connection", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      const res = await api.inject(
        authed(s.cookie, {
          method: "PUT",
          url: `/api/companies/${c.companyId}/preference`,
          payload: { preference: "PREFER" },
        }),
      );
      expect(res.statusCode).toBe(409);
    });

    it("the carrier can never read the shipper's private preference on it", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      await connected(s, c);
      await api.inject(
        authed(s.cookie, {
          method: "PUT",
          url: `/api/companies/${c.companyId}/preference`,
          payload: { preference: "DO_NOT_PREFER" },
        }),
      );
      // The carrier calls the exact same URL shape from its OWN session — the
      // query is always "MY preference on that company", so this can never
      // resolve to the shipper's actual preference.
      const asCarrier = await api.inject(
        authed(c.cookie, { method: "GET", url: `/api/companies/${c.companyId}/preference` }),
      );
      expect(asCarrier.statusCode).toBe(404);
    });

    it("setting a preference does not alter connection state", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      const id = await connected(s, c);
      await api.inject(
        authed(s.cookie, {
          method: "PUT",
          url: `/api/companies/${c.companyId}/preference`,
          payload: { preference: "PREFER" },
        }),
      );
      const conn = await getConnection(s.cookie, id);
      expect(conn.json().status).toBe("ACCEPTED");
    });
  });

  // ── BLOCK ─────────────────────────────────────────────────────────

  describe("Block", () => {
    it("company-primary/admin may block; an ordinary member may not", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      const ordinary = await ordinaryMember(s, "SHIPPER", "block");
      const denied = await api.inject(
        authed(ordinary, { method: "POST", url: `/api/companies/${c.companyId}/block` }),
      );
      expect(denied.statusCode).toBe(403);

      const res = await api.inject(
        authed(s.cookie, { method: "POST", url: `/api/companies/${c.companyId}/block` }),
      );
      expect(res.statusCode).toBe(201);
    });

    it("blocks with no active freight take effect immediately (ACTIVE)", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      const res = await api.inject(
        authed(s.cookie, { method: "POST", url: `/api/companies/${c.companyId}/block` }),
      );
      expect(res.json().status).toBe("ACTIVE");
      expect(res.json().effectiveAt).not.toBeNull();
    });

    it("blocks with active freight start PENDING_ON_COMPLETION", async () => {
      const s = await shipperCo();
      const c = await carrierCo("Longhorn Transportation Active");
      await awardedLoad(s, c);
      const res = await api.inject(
        authed(s.cookie, { method: "POST", url: `/api/companies/${c.companyId}/block` }),
      );
      expect(res.json().status).toBe("PENDING_ON_COMPLETION");
      expect(res.json().effectiveAt).toBeNull();
    });

    it("the blocked company has no visibility into the block", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      await api.inject(authed(s.cookie, { method: "POST", url: `/api/companies/${c.companyId}/block` }));
      const asBlocked = await api.inject(authed(c.cookie, { method: "GET", url: "/api/blocks" }));
      expect(asBlocked.json().data).toEqual([]);
    });

    it("unblock preserves history — the row becomes INACTIVE, never deleted", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      const block = await api.inject(
        authed(s.cookie, { method: "POST", url: `/api/companies/${c.companyId}/block` }),
      );
      const unblock = await api.inject(
        authed(s.cookie, { method: "POST", url: `/api/companies/${c.companyId}/unblock` }),
      );
      expect(unblock.statusCode).toBe(200);
      expect(unblock.json().status).toBe("INACTIVE");

      const row = await prisma.companyBlock.findUnique({ where: { id: block.json().id } });
      expect(row).not.toBeNull();
      expect(row?.status).toBe("INACTIVE");
      expect(row?.removedAt).not.toBeNull();
    });

    it("a company may re-block after unblocking (new episode, old one preserved)", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      await api.inject(authed(s.cookie, { method: "POST", url: `/api/companies/${c.companyId}/block` }));
      await api.inject(authed(s.cookie, { method: "POST", url: `/api/companies/${c.companyId}/unblock` }));
      const reBlock = await api.inject(
        authed(s.cookie, { method: "POST", url: `/api/companies/${c.companyId}/block` }),
      );
      expect(reBlock.statusCode).toBe(201);
      const rows = await prisma.companyBlock.findMany({
        where: { blockingCompanyId: s.companyId, blockedCompanyId: c.companyId },
      });
      expect(rows).toHaveLength(2);
    });

    it("block is directional — both companies may independently block each other", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      const aBlocksB = await api.inject(
        authed(s.cookie, { method: "POST", url: `/api/companies/${c.companyId}/block` }),
      );
      const bBlocksA = await api.inject(
        authed(c.cookie, { method: "POST", url: `/api/companies/${s.companyId}/block` }),
      );
      expect(aBlocksB.statusCode).toBe(201);
      expect(bBlocksA.statusCode).toBe(201);
    });

    it("recheckContinuity resolves PENDING_ON_COMPLETION to ACTIVE once freight ends", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      const loadId = await awardedLoad(s, c);
      const block = await api.inject(
        authed(s.cookie, { method: "POST", url: `/api/companies/${c.companyId}/block` }),
      );
      expect(block.json().status).toBe("PENDING_ON_COMPLETION");

      // Simulate the freight ending (cancellation) — Phase 2 does not wire
      // this automatically into loads.service.ts; this proves the
      // truth-detection query and status flip are correct and ready for a
      // later phase to trigger from the real completion/cancellation path.
      await prisma.load.update({ where: { id: loadId }, data: { status: "CANCELLED" } });

      const recheck = await api.inject(
        authed(s.cookie, {
          method: "POST",
          url: `/api/blocks/${block.json().id}/recheck-continuity`,
        }),
      );
      expect(recheck.statusCode).toBe(200);
      expect(recheck.json().status).toBe("ACTIVE");
    });
  });

  // ── CARRIER GROUPS ────────────────────────────────────────────────

  describe("Carrier groups", () => {
    it("company-primary/admin CRUD; an ordinary member is rejected", async () => {
      const s = await shipperCo();
      const ordinary = await ordinaryMember(s, "SHIPPER", "group");
      const denied = await api.inject(
        authed(ordinary, { method: "POST", url: "/api/carrier-groups", payload: { name: "Texas Dry Van" } }),
      );
      expect(denied.statusCode).toBe(403);

      const create = await api.inject(
        authed(s.cookie, { method: "POST", url: "/api/carrier-groups", payload: { name: "Texas Dry Van" } }),
      );
      expect(create.statusCode).toBe(201);
      const groupId = create.json().id;

      const update = await api.inject(
        authed(s.cookie, {
          method: "PATCH",
          url: `/api/carrier-groups/${groupId}`,
          payload: { name: "Texas Dry Van (renamed)" },
        }),
      );
      expect(update.statusCode).toBe(200);

      const del = await api.inject(
        authed(s.cookie, { method: "DELETE", url: `/api/carrier-groups/${groupId}` }),
      );
      expect(del.statusCode).toBe(204);
    });

    it("prevents duplicate group names within a company (case-insensitive)", async () => {
      const s = await shipperCo();
      await api.inject(
        authed(s.cookie, { method: "POST", url: "/api/carrier-groups", payload: { name: "Backup Capacity" } }),
      );
      const dup = await api.inject(
        authed(s.cookie, { method: "POST", url: "/api/carrier-groups", payload: { name: "backup capacity" } }),
      );
      expect(dup.statusCode).toBe(409);
    });

    it("only an ACCEPTED connected carrier may be added; the same carrier cannot be added twice", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      const group = await api.inject(
        authed(s.cookie, { method: "POST", url: "/api/carrier-groups", payload: { name: "Preferred Midwest" } }),
      );
      const groupId = group.json().id;

      const beforeConnect = await api.inject(
        authed(s.cookie, {
          method: "POST",
          url: `/api/carrier-groups/${groupId}/members`,
          payload: { carrierCompanyId: c.companyId },
        }),
      );
      expect(beforeConnect.statusCode).toBe(409);

      await connected(s, c);
      const added = await api.inject(
        authed(s.cookie, {
          method: "POST",
          url: `/api/carrier-groups/${groupId}/members`,
          payload: { carrierCompanyId: c.companyId },
        }),
      );
      expect(added.statusCode).toBe(201);

      const duplicate = await api.inject(
        authed(s.cookie, {
          method: "POST",
          url: `/api/carrier-groups/${groupId}/members`,
          payload: { carrierCompanyId: c.companyId },
        }),
      );
      expect(duplicate.statusCode).toBe(409);
    });

    it("a blocked carrier cannot be added even with an ACCEPTED connection", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      await connected(s, c);
      await api.inject(authed(s.cookie, { method: "POST", url: `/api/companies/${c.companyId}/block` }));
      const group = await api.inject(
        authed(s.cookie, { method: "POST", url: "/api/carrier-groups", payload: { name: "Reefer Network" } }),
      );
      const added = await api.inject(
        authed(s.cookie, {
          method: "POST",
          url: `/api/carrier-groups/${group.json().id}/members`,
          payload: { carrierCompanyId: c.companyId },
        }),
      );
      expect(added.statusCode).toBe(409);
    });

    it("removing a member, or deleting the group, does not disconnect the carrier", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      const connectionId = await connected(s, c);
      const group = await api.inject(
        authed(s.cookie, { method: "POST", url: "/api/carrier-groups", payload: { name: "Backup Capacity 2" } }),
      );
      const groupId = group.json().id;
      await api.inject(
        authed(s.cookie, {
          method: "POST",
          url: `/api/carrier-groups/${groupId}/members`,
          payload: { carrierCompanyId: c.companyId },
        }),
      );

      const removeMember = await api.inject(
        authed(s.cookie, {
          method: "DELETE",
          url: `/api/carrier-groups/${groupId}/members/${c.companyId}`,
        }),
      );
      expect(removeMember.statusCode).toBe(204);
      let conn = await getConnection(s.cookie, connectionId);
      expect(conn.json().status).toBe("ACCEPTED");

      await api.inject(
        authed(s.cookie, {
          method: "POST",
          url: `/api/carrier-groups/${groupId}/members`,
          payload: { carrierCompanyId: c.companyId },
        }),
      );
      const deleteGroup = await api.inject(
        authed(s.cookie, { method: "DELETE", url: `/api/carrier-groups/${groupId}` }),
      );
      expect(deleteGroup.statusCode).toBe(204);
      conn = await getConnection(s.cookie, connectionId);
      expect(conn.json().status).toBe("ACCEPTED");
    });

    it("the carrier has no visibility into groups it belongs to", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      await connected(s, c);
      const group = await api.inject(
        authed(s.cookie, { method: "POST", url: "/api/carrier-groups", payload: { name: "Hidden Group" } }),
      );
      await api.inject(
        authed(s.cookie, {
          method: "POST",
          url: `/api/carrier-groups/${group.json().id}/members`,
          payload: { carrierCompanyId: c.companyId },
        }),
      );
      const asCarrier = await api.inject(authed(c.cookie, { method: "GET", url: "/api/carrier-groups" }));
      expect(asCarrier.json().data).toEqual([]);
    });
  });

  // ── FACILITY SCOPE ────────────────────────────────────────────────

  describe("Facility scope", () => {
    it("no rows means company-wide access", async () => {
      const s = await shipperCo();
      const membershipId = await prisma.membership
        .findFirstOrThrow({ where: { userId: s.userId, companyId: s.companyId } })
        .then((m) => m.id);
      const res = await api.inject(
        authed(s.cookie, { method: "GET", url: `/api/memberships/${membershipId}/facility-scope` }),
      );
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ membershipId, locationIds: [], companyWide: true });
    });

    it("one or more rows restricts scope, and duplicates in the request are not persisted twice", async () => {
      const s = await shipperCo();
      const loc = await createLocation(api, s.cookie, { city: "Austin", state: "TX" });
      const membershipId = await prisma.membership
        .findFirstOrThrow({ where: { userId: s.userId, companyId: s.companyId } })
        .then((m) => m.id);

      const set = await api.inject(
        authed(s.cookie, {
          method: "PUT",
          url: `/api/memberships/${membershipId}/facility-scope`,
          payload: { locationIds: [loc, loc] },
        }),
      );
      expect(set.statusCode).toBe(200);
      expect(set.json().companyWide).toBe(false);
      expect(set.json().locationIds).toEqual([loc]);

      const rows = await prisma.membershipFacilityScope.findMany({ where: { membershipId } });
      expect(rows).toHaveLength(1);
    });

    it("rejects a location belonging to another company", async () => {
      const s = await shipperCo();
      const other = await shipperCo("Other Shipper Co");
      const foreignLoc = await createLocation(api, other.cookie, { city: "Houston", state: "TX" });
      const membershipId = await prisma.membership
        .findFirstOrThrow({ where: { userId: s.userId, companyId: s.companyId } })
        .then((m) => m.id);

      const res = await api.inject(
        authed(s.cookie, {
          method: "PUT",
          url: `/api/memberships/${membershipId}/facility-scope`,
          payload: { locationIds: [foreignLoc] },
        }),
      );
      expect(res.statusCode).toBe(400);

      const rows = await prisma.membershipFacilityScope.findMany({ where: { membershipId } });
      expect(rows).toHaveLength(0);
    });

    it("an ordinary member cannot alter another user's facility scope", async () => {
      const s = await shipperCo();
      const ordinaryCookie = await ordinaryMember(s, "SHIPPER", "facility");
      const primaryMembershipId = await prisma.membership
        .findFirstOrThrow({ where: { userId: s.userId, companyId: s.companyId } })
        .then((m) => m.id);

      const res = await api.inject(
        authed(ordinaryCookie, {
          method: "PUT",
          url: `/api/memberships/${primaryMembershipId}/facility-scope`,
          payload: { locationIds: [] },
        }),
      );
      expect(res.statusCode).toBe(403);
    });
  });
});
