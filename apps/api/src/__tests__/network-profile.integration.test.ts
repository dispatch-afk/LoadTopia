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

suite("company profile + eligible carriers (M4 Phase 3, integration)", () => {
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

  async function shipperCo(name = "Acme Manufacturing"): Promise<Session> {
    return registerCompany(api, { type: "SHIPPER", companyName: name });
  }
  async function carrierCo(name = "Longhorn Transportation"): Promise<Session> {
    return registerCompany(api, { type: "CARRIER", companyName: name });
  }

  async function connected(shipper: Session, carrier: Session): Promise<string> {
    const req = await api.inject(
      authed(shipper.cookie, { method: "POST", url: `/api/companies/${carrier.companyId}/connections` }),
    );
    const connectionId = req.json().id;
    const accept = await api.inject(
      authed(carrier.cookie, { method: "POST", url: `/api/connections/${connectionId}/accept` }),
    );
    expect(accept.statusCode).toBe(200);
    return connectionId;
  }

  async function profile(actorCookie: string, companyId: string) {
    return api.inject(authed(actorCookie, { method: "GET", url: `/api/companies/${companyId}/profile` }));
  }

  /** A full award (not a mere offer) between a shipper and carrier — the
   *  ONLY thing that should ever count as verified shared history. */
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
    const loadId = draft.json().id;
    await api.inject(authed(shipper.cookie, { method: "POST", url: `/api/loads/${loadId}/post` }));
    await api.inject(
      authed(carrier.cookie, {
        method: "PUT",
        url: "/api/carrier/profile",
        payload: { legalName: "Longhorn Transportation LLC", equipmentTypes: [], serviceAreaStates: [] },
      }),
    );
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
    const roundId = offer.json().rounds[0].id;
    const accept = await api.inject(
      authed(shipper.cookie, { method: "POST", url: `/api/offers/rounds/${roundId}/accept` }),
    );
    expect(accept.statusCode).toBe(200);
    return loadId;
  }

  /** A losing offer thread — never awarded — must NEVER count as shared
   *  history. */
  async function losingOffer(shipper: Session, loser: Session, winner: Session): Promise<void> {
    const origin = await createLocation(api, shipper.cookie, { city: "Denver", state: "CO" });
    const dest = await createLocation(api, shipper.cookie, { city: "Phoenix", state: "AZ" });
    const draft = await api.inject(
      authed(shipper.cookie, {
        method: "POST",
        url: "/api/loads",
        payload: {
          originLocationId: origin,
          destinationLocationId: dest,
          equipmentType: "DRY_VAN",
          mode: "FTL",
          commodity: "General freight",
          weightLbs: 20000,
          pickupWindowStart: future(4, 8),
          pickupWindowEnd: future(4, 16),
          deliveryWindowStart: future(6, 8),
          deliveryWindowEnd: future(6, 17),
        },
      }),
    );
    const loadId = draft.json().id;
    await api.inject(authed(shipper.cookie, { method: "POST", url: `/api/loads/${loadId}/post` }));
    for (const c of [loser, winner]) {
      await api.inject(
        authed(c.cookie, {
          method: "PUT",
          url: "/api/carrier/profile",
          payload: { legalName: `${c.email} LLC`, equipmentTypes: [], serviceAreaStates: [] },
        }),
      );
      await prisma.carrierProfile.update({
        where: { companyId: c.companyId },
        data: { marketplaceEligibility: "ELIGIBLE", verificationStatus: "VERIFIED" },
      });
    }
    await api.inject(
      authed(loser.cookie, {
        method: "POST",
        url: `/api/marketplace/loads/${loadId}/offers`,
        payload: { amount: "1500.00", currency: "USD" },
      }),
    );
    const winOffer = await api.inject(
      authed(winner.cookie, {
        method: "POST",
        url: `/api/marketplace/loads/${loadId}/offers`,
        payload: { amount: "1600.00", currency: "USD" },
      }),
    );
    const roundId = winOffer.json().rounds[0].id;
    await api.inject(authed(shipper.cookie, { method: "POST", url: `/api/offers/rounds/${roundId}/accept` }));
  }

  describe("Company Profile", () => {
    it("shows factual identity and a carrier's self-declared capabilities", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      await api.inject(
        authed(c.cookie, {
          method: "PUT",
          url: "/api/carrier/profile",
          payload: { legalName: "Longhorn LLC", equipmentTypes: ["DRY_VAN", "REEFER"], serviceAreaStates: ["TX"] },
        }),
      );

      const res = await profile(s.cookie, c.companyId);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.name).toBe("Longhorn Transportation");
      expect(body.type).toBe("CARRIER");
      expect(body.capabilities.legalName).toBe("Longhorn LLC");
      expect(body.capabilities.equipmentTypes).toEqual(["DRY_VAN", "REEFER"]);
      expect(body.capabilities.serviceAreaStates).toEqual(["TX"]);
    });

    it("has no connection before one exists, and a truthful zero-history summary", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      const res = await profile(s.cookie, c.companyId);
      expect(res.json().relationship.connection).toBeNull();
      expect(res.json().sharedHistory).toEqual({
        shipmentsTogether: 0,
        completedShipments: 0,
        activeShipments: 0,
        lastWorkedTogether: null,
        recentLanes: [],
      });
    });

    it("reflects connection state and event history once connected", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      await connected(s, c);

      const res = await profile(s.cookie, c.companyId);
      expect(res.json().relationship.connection.status).toBe("ACCEPTED");
      const types = res.json().relationship.connectionEvents.map((e: { type: string }) => e.type);
      expect(types).toEqual(["REQUESTED", "ACCEPTED"]);
    });

    it("reflects the carrier's own follow state, private to the carrier", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      await api.inject(authed(c.cookie, { method: "POST", url: `/api/companies/${s.companyId}/follow` }));

      const asCarrier = await profile(c.cookie, s.companyId);
      expect(asCarrier.json().relationship.isFollowing).toBe(true);
    });

    it("only counts VERIFIED (awarded) freight — never a losing offer or mere marketplace exposure", async () => {
      const s = await shipperCo();
      const winner = await carrierCo("Winner Co");
      const loser = await carrierCo("Loser Co");
      await losingOffer(s, loser, winner);

      const loserProfile = await profile(s.cookie, loser.companyId);
      expect(loserProfile.json().sharedHistory.shipmentsTogether).toBe(0);

      const winnerProfile = await profile(s.cookie, winner.companyId);
      expect(winnerProfile.json().sharedHistory.shipmentsTogether).toBe(1);
      expect(winnerProfile.json().sharedHistory.recentLanes).toHaveLength(1);
    });

    it("counts a completed shipment correctly and reports the most recent lane", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      const loadId = await awardedLoad(s, c);

      const before = await profile(s.cookie, c.companyId);
      expect(before.json().sharedHistory.shipmentsTogether).toBe(1);
      expect(before.json().sharedHistory.completedShipments).toBe(0);
      expect(before.json().sharedHistory.activeShipments).toBe(1);

      await prisma.load.update({ where: { id: loadId }, data: { status: "COMPLETED" } });
      const after = await profile(s.cookie, c.companyId);
      expect(after.json().sharedHistory.completedShipments).toBe(1);
      expect(after.json().sharedHistory.activeShipments).toBe(0);
      expect(after.json().sharedHistory.lastWorkedTogether).not.toBeNull();
    });

    it("PRIVACY: the carrier viewing its own profile from the shipper's profile page context never receives the shipper's preference, groups, or block state", async () => {
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

      // The carrier views the SHIPPER's profile (the only direction it can
      // view) — none of the shipper's private state about the carrier is
      // reachable through this payload.
      const asCarrier = await profile(c.cookie, s.companyId);
      expect(asCarrier.json().relationship.preference).toBeNull();
      expect(asCarrier.json().relationship.groups).toBeNull();
    });

    it("PRIVACY: a block never appears on the blocked company's own profile view", async () => {
      const s = await shipperCo();
      const c = await carrierCo();
      await api.inject(authed(s.cookie, { method: "POST", url: `/api/companies/${c.companyId}/block` }));

      const asBlocked = await profile(c.cookie, s.companyId);
      expect(asBlocked.json().relationship.blockStatus).toBeNull();

      const asBlocker = await profile(s.cookie, c.companyId);
      expect(asBlocker.json().relationship.blockStatus).toBe("ACTIVE");
    });

    it("404s for a non-existent company (no existence oracle)", async () => {
      const s = await shipperCo();
      const res = await profile(s.cookie, "00000000-0000-0000-0000-000000000000");
      expect(res.statusCode).toBe(404);
    });
  });

  describe("Eligible carriers for group membership", () => {
    it("lists only ACCEPTED-connected carriers, excluding existing members and blocked companies", async () => {
      const s = await shipperCo();
      const connectedCarrier = await carrierCo("Connected Co");
      const pendingCarrier = await carrierCo("Pending Co");
      const blockedCarrier = await carrierCo("Blocked Co");
      const alreadyMemberCarrier = await carrierCo("Already Member Co");

      await connected(s, connectedCarrier);
      await connected(s, alreadyMemberCarrier);
      await api.inject(
        authed(s.cookie, { method: "POST", url: `/api/companies/${pendingCarrier.companyId}/connections` }),
      );
      await connected(s, blockedCarrier);
      await api.inject(
        authed(s.cookie, { method: "POST", url: `/api/companies/${blockedCarrier.companyId}/block` }),
      );

      const group = await api.inject(
        authed(s.cookie, { method: "POST", url: "/api/carrier-groups", payload: { name: "Group" } }),
      );
      const groupId = group.json().id;
      await api.inject(
        authed(s.cookie, {
          method: "POST",
          url: `/api/carrier-groups/${groupId}/members`,
          payload: { carrierCompanyId: alreadyMemberCarrier.companyId },
        }),
      );

      const res = await api.inject(
        authed(s.cookie, { method: "GET", url: `/api/carrier-groups/${groupId}/eligible-carriers` }),
      );
      expect(res.statusCode).toBe(200);
      const ids = res.json().data.map((c: { companyId: string }) => c.companyId);
      expect(ids).toEqual([connectedCarrier.companyId]);
      expect(ids).not.toContain(pendingCarrier.companyId);
      expect(ids).not.toContain(blockedCarrier.companyId);
      expect(ids).not.toContain(alreadyMemberCarrier.companyId);
    });
  });
});
