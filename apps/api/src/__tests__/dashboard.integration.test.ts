import type { PrismaClient } from "@loadtopia/db";
import { FakeStorageProvider } from "@loadtopia/providers";
import type { CarrierAttentionKind, ShipperAttentionKind } from "@loadtopia/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { providersWithFakeStorage } from "./helpers";
import {
  addNonPrimaryMember,
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

type ShipperFx = Session & { origin: string; dest: string; a: string; b: string; c: string };

suite("Dashboard summary — Attention Center (M4 Phase 8, integration)", () => {
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

  async function shipper(name = "Acme Freight"): Promise<ShipperFx> {
    const s = await registerCompany(api, { type: "SHIPPER", companyName: name });
    const origin = await createLocation(api, s.cookie, { name: "O", city: "Chicago", state: "IL" });
    const dest = await createLocation(api, s.cookie, { name: "D", city: "Dallas", state: "TX" });
    const a = await createLocation(api, s.cookie, { name: "A", city: "Denver", state: "CO" });
    const b = await createLocation(api, s.cookie, { name: "B", city: "Miami", state: "FL" });
    const c = await createLocation(api, s.cookie, { name: "C", city: "Boise", state: "ID" });
    return { ...s, origin, dest, a, b, c };
  }

  async function carrier(name = "Sunrise Carriers"): Promise<Session> {
    const s = await registerCompany(api, { type: "CARRIER", companyName: name });
    await api.inject(
      authed(s.cookie, {
        method: "PUT",
        url: "/api/carrier/profile",
        payload: { legalName: `${name} LLC`, equipmentTypes: [], serviceAreaStates: [] },
      }),
    );
    await prisma.carrierProfile.update({
      where: { companyId: s.companyId },
      data: { marketplaceEligibility: "ELIGIBLE", verificationStatus: "VERIFIED" },
    });
    return s;
  }

  async function dispatcher(
    primary: Session,
    label: string,
    scopeLocationIds?: string[],
  ): Promise<{ cookie: string; membershipId: string }> {
    const throwaway = await registerCompany(api, {
      type: "SHIPPER",
      companyName: `throwaway-${label}-${primary.companyId}`,
    });
    const cookie = await addNonPrimaryMember(api, primary.cookie, primary.companyId, {
      email: throwaway.email,
      role: "SHIPPER",
    });
    const membershipId = await prisma.membership
      .findFirstOrThrow({ where: { userId: throwaway.userId, companyId: primary.companyId } })
      .then((m) => m.id);
    if (scopeLocationIds !== undefined) {
      const set = await api.inject(
        authed(primary.cookie, {
          method: "PUT",
          url: `/api/memberships/${membershipId}/facility-scope`,
          payload: { locationIds: scopeLocationIds },
        }),
      );
      if (set.statusCode !== 200) throw new Error(`set scope ${set.statusCode}: ${set.body}`);
    }
    return { cookie, membershipId };
  }

  async function loadBetween(
    s: Session,
    originId: string,
    destId: string,
    over: Record<string, unknown> = {},
  ): Promise<string> {
    const draft = await api.inject(
      authed(s.cookie, {
        method: "POST",
        url: "/api/loads",
        payload: {
          originLocationId: originId,
          destinationLocationId: destId,
          equipmentType: "DRY_VAN",
          mode: "FTL",
          commodity: "goods",
          weightLbs: 1000,
          pickupWindowStart: future(3),
          pickupWindowEnd: future(3, 16),
          deliveryWindowStart: future(5),
          deliveryWindowEnd: future(5, 17),
          ...over,
        },
      }),
    );
    if (draft.statusCode !== 201) throw new Error(`loadBetween ${draft.statusCode}: ${draft.body}`);
    return draft.json().id;
  }

  async function postLoad(s: ShipperFx, loadId: string): Promise<void> {
    const post = await api.inject(authed(s.cookie, { method: "POST", url: `/api/loads/${loadId}/post` }));
    if (post.statusCode !== 200) throw new Error(`post ${post.statusCode}: ${post.body}`);
  }

  /** Post -> negotiated offer -> shipper accepts. Auto-assigns atomically. */
  async function assignLoad(s: ShipperFx, c: Session, loadId: string): Promise<void> {
    await postLoad(s, loadId);
    const offer = await api.inject(
      authed(c.cookie, {
        method: "POST",
        url: `/api/marketplace/loads/${loadId}/offers`,
        payload: { amount: "1000.00", currency: "USD" },
      }),
    );
    if (offer.statusCode !== 201) throw new Error(`offer ${offer.statusCode}: ${offer.body}`);
    const accept = await api.inject(
      authed(s.cookie, {
        method: "POST",
        url: `/api/offers/rounds/${offer.json().rounds[0].id}/accept`,
      }),
    );
    if (accept.statusCode !== 200) throw new Error(`accept ${accept.statusCode}: ${accept.body}`);
  }

  const op = (cookie: string, loadId: string, verb: "pickup" | "in-transit" | "deliver") =>
    api.inject(authed(cookie, { method: "POST", url: `/api/loads/${loadId}/${verb}` }));

  async function uploadAndConfirmPod(c: Session, loadId: string): Promise<string> {
    const r = await api.inject(
      authed(c.cookie, {
        method: "POST",
        url: `/api/loads/${loadId}/documents`,
        payload: {
          documentType: "POD",
          originalFilename: "pod.pdf",
          contentType: "application/pdf",
          sizeBytes: 256,
        },
      }),
    );
    if (r.statusCode !== 201) throw new Error(`uploadPod ${r.statusCode}: ${r.body}`);
    const id = r.json().document.id;
    fake.simulateUpload(`loads/${loadId}/documents/${id}`, new Uint8Array(256), "application/pdf");
    const confirm = await api.inject(
      authed(c.cookie, { method: "POST", url: `/api/load-documents/${id}/confirm` }),
    );
    if (confirm.statusCode !== 200) throw new Error(`confirm ${confirm.statusCode}: ${confirm.body}`);
    return id;
  }

  const approve = (cookie: string, id: string) =>
    api.inject(authed(cookie, { method: "POST", url: `/api/load-documents/${id}/approve` }));
  const reject = (cookie: string, id: string) =>
    api.inject(authed(cookie, {
      method: "POST",
      url: `/api/load-documents/${id}/reject`,
      payload: { reason: "wrong document" },
    }));

  /** Drive a load through to DELIVERED via the assigned carrier. */
  async function deliveredLoad(s: ShipperFx, c: Session, originId: string, destId: string): Promise<string> {
    const loadId = await loadBetween(s, originId, destId);
    await assignLoad(s, c, loadId);
    for (const verb of ["pickup", "in-transit", "deliver"] as const) {
      const r = await op(c.cookie, loadId, verb);
      if (r.statusCode !== 200) throw new Error(`${verb} ${r.statusCode}: ${r.body}`);
    }
    return loadId;
  }

  async function getSummary(cookie: string) {
    const res = await api.inject(authed(cookie, { method: "GET", url: "/api/dashboard/summary" }));
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  function attentionCount(
    body: { attention: { kind: string; count: number }[] },
    kind: ShipperAttentionKind | CarrierAttentionKind,
  ): number {
    return body.attention.find((a) => a.kind === kind)?.count ?? -1;
  }

  // ── SHIPPER ─────────────────────────────────────────────────────────

  describe("shipper summary", () => {
    it("1. empty company -> every count and attention item is zero, recentShipments empty", async () => {
      const s = await shipper();
      const body = await getSummary(s.cookie);
      expect(body.role).toBe("SHIPPER");
      expect(body.overview).toEqual({ activeShipmentCount: 0, draftLoadCount: 0, totalLoadCount: 0 });
      for (const item of body.attention) expect(item.count).toBe(0);
      expect(body.recentShipments).toEqual([]);
    });

    it("2. Needs Coverage counts POSTED and OFFER_RECEIVED, excludes DRAFT/AWARDED", async () => {
      const s = await shipper();
      const c = await carrier();
      await loadBetween(s, s.origin, s.dest); // DRAFT — not coverage
      const posted = await loadBetween(s, s.origin, s.dest);
      await postLoad(s, posted); // POSTED — coverage
      const offered = await loadBetween(s, s.origin, s.dest);
      await postLoad(s, offered);
      const offer = await api.inject(
        authed(c.cookie, {
          method: "POST",
          url: `/api/marketplace/loads/${offered}/offers`,
          payload: { amount: "500.00", currency: "USD" },
        }),
      );
      expect(offer.statusCode).toBe(201); // OFFER_RECEIVED — coverage
      const awarded = await loadBetween(s, s.origin, s.dest);
      await assignLoad(s, c, awarded); // AWARDED+ — not coverage

      const body = await getSummary(s.cookie);
      expect(attentionCount(body, "NEEDS_COVERAGE")).toBe(2);
      expect(body.overview.totalLoadCount).toBe(4);
      expect(body.overview.draftLoadCount).toBe(1);
    });

    it("3. active shipment count spans AWARDED through DELIVERED", async () => {
      const s = await shipper();
      const c = await carrier();
      const awarded = await loadBetween(s, s.origin, s.dest);
      await assignLoad(s, c, awarded);
      const delivered = await deliveredLoad(s, c, s.origin, s.dest);
      const draft = await loadBetween(s, s.origin, s.dest);
      void draft;

      const body = await getSummary(s.cookie);
      expect(body.overview.activeShipmentCount).toBe(2);
      expect(delivered).toBeTruthy();
    });

    it("4. a PENDING_REVIEW POD is counted as POD Awaiting Review", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await deliveredLoad(s, c, s.origin, s.dest);
      await uploadAndConfirmPod(c, loadId);

      const body = await getSummary(s.cookie);
      expect(attentionCount(body, "POD_AWAITING_REVIEW")).toBe(1);
      expect(attentionCount(body, "READY_TO_COMPLETE")).toBe(0);
      expect(attentionCount(body, "REPLACEMENT_POD_NEEDED")).toBe(0);
    });

    it("5. an approved POD is counted as Ready to Complete", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await deliveredLoad(s, c, s.origin, s.dest);
      const docId = await uploadAndConfirmPod(c, loadId);
      expect((await approve(s.cookie, docId)).statusCode).toBe(200);

      const body = await getSummary(s.cookie);
      expect(attentionCount(body, "READY_TO_COMPLETE")).toBe(1);
      expect(attentionCount(body, "POD_AWAITING_REVIEW")).toBe(0);
    });

    it("6. a rejected POD is counted as Replacement POD Needed", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await deliveredLoad(s, c, s.origin, s.dest);
      const docId = await uploadAndConfirmPod(c, loadId);
      expect((await reject(s.cookie, docId)).statusCode).toBe(200);

      const body = await getSummary(s.cookie);
      expect(attentionCount(body, "REPLACEMENT_POD_NEEDED")).toBe(1);
      expect(attentionCount(body, "READY_TO_COMPLETE")).toBe(0);
    });

    it("7. Phase 6 precedence: an approved POD plus a LATER pending/rejected POD stays Ready to Complete", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await deliveredLoad(s, c, s.origin, s.dest);
      const firstDoc = await uploadAndConfirmPod(c, loadId);
      expect((await approve(s.cookie, firstDoc)).statusCode).toBe(200);
      // A second, unrelated POD uploaded afterward — approval must still dominate.
      await uploadAndConfirmPod(c, loadId);

      const body = await getSummary(s.cookie);
      expect(attentionCount(body, "READY_TO_COMPLETE")).toBe(1);
      expect(attentionCount(body, "POD_AWAITING_REVIEW")).toBe(0);

      // And /complete still succeeds — the dashboard count agrees with the
      // authoritative rule, not merely looks similar to it.
      const complete = await api.inject(
        authed(s.cookie, { method: "POST", url: `/api/loads/${loadId}/complete` }),
      );
      expect(complete.statusCode).toBe(200);
    });

    it("8. a facility-scoped dispatcher's summary excludes out-of-scope freight from every count and the recent list", async () => {
      const s = await shipper();
      const c = await carrier();
      const dispA = await dispatcher(s, "dash-a", [s.a]);

      // In-scope (origin = A): posted (coverage) + a full delivered shipment.
      const inScopePosted = await loadBetween(s, s.a, s.dest);
      await postLoad(s, inScopePosted);
      const inScopeDelivered = await deliveredLoad(s, c, s.a, s.dest);
      const inScopeDocId = await uploadAndConfirmPod(c, inScopeDelivered);
      expect((await approve(s.cookie, inScopeDocId)).statusCode).toBe(200);

      // Out-of-scope (origin = B, destination = C — neither is A): posted +
      // a full delivered+approved shipment, exactly mirroring the in-scope
      // fixture so a leak would be caught by every count, not just one.
      const outOfScopePosted = await loadBetween(s, s.b, s.c);
      await postLoad(s, outOfScopePosted);
      const outOfScopeDelivered = await deliveredLoad(s, c, s.b, s.c);
      const outOfScopeDocId = await uploadAndConfirmPod(c, outOfScopeDelivered);
      expect((await approve(s.cookie, outOfScopeDocId)).statusCode).toBe(200);

      const body = await getSummary(dispA.cookie);
      expect(attentionCount(body, "NEEDS_COVERAGE")).toBe(1);
      expect(attentionCount(body, "READY_TO_COMPLETE")).toBe(1);
      expect(body.overview.totalLoadCount).toBe(2);
      expect(body.overview.activeShipmentCount).toBe(1);

      const ids = body.recentShipments.map((r: { id: string }) => r.id);
      expect(ids).toContain(inScopeDelivered);
      expect(ids).not.toContain(outOfScopeDelivered);

      // And no reference to the out-of-scope load leaks anywhere in the
      // serialized response at all — not just the fields checked above.
      expect(JSON.stringify(body)).not.toContain(outOfScopeDelivered);
      expect(JSON.stringify(body)).not.toContain(outOfScopePosted);
    });

    it("9. an unscoped membership retains a full company-wide summary", async () => {
      const s = await shipper();
      const c = await carrier();
      await dispatcher(s, "dash-unscoped");
      const loadA = await loadBetween(s, s.a, s.dest);
      await postLoad(s, loadA);
      const loadC = await deliveredLoad(s, c, s.b, s.c);

      const body = await getSummary(s.cookie);
      expect(body.overview.totalLoadCount).toBe(2);
      const ids = body.recentShipments.map((r: { id: string }) => r.id);
      expect(ids).toContain(loadC);
      void loadA;
    });

    it("10. one shipper's summary never includes another company's freight", async () => {
      const s = await shipper("Company One");
      const other = await shipper("Company Two");
      await loadBetween(other, other.origin, other.dest);

      const body = await getSummary(s.cookie);
      expect(body.overview.totalLoadCount).toBe(0);
    });
  });

  // ── CARRIER ─────────────────────────────────────────────────────────

  describe("carrier summary", () => {
    it("11. available-freight count reflects the real marketplace board for an eligible carrier", async () => {
      const s = await shipper();
      const c = await carrier();
      const posted = await loadBetween(s, s.origin, s.dest);
      await postLoad(s, posted);

      const body = await getSummary(c.cookie);
      expect(body.marketplaceEligible).toBe(true);
      expect(body.overview.availableFreightCount).toBeGreaterThanOrEqual(1);
    });

    it("12/13. active offers and awaiting-my-response reuse respondingParty semantics", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await loadBetween(s, s.origin, s.dest);
      await postLoad(s, loadId);
      const offer = await api.inject(
        authed(c.cookie, {
          method: "POST",
          url: `/api/marketplace/loads/${loadId}/offers`,
          payload: { amount: "900.00", currency: "USD" },
        }),
      );
      expect(offer.statusCode).toBe(201);
      const roundId = offer.json().rounds[0].id;

      // Carrier proposed the current round — NOT awaiting the carrier's response.
      let body = await getSummary(c.cookie);
      expect(body.overview.activeOfferCount).toBe(1);
      expect(attentionCount(body, "AWAITING_MY_RESPONSE")).toBe(0);

      // Shipper counters — now it IS the carrier's turn.
      const counter = await api.inject(
        authed(s.cookie, {
          method: "POST",
          url: `/api/offers/rounds/${roundId}/counter`,
          payload: { amount: "950.00", currency: "USD" },
        }),
      );
      expect(counter.statusCode).toBe(200);

      body = await getSummary(c.cookie);
      expect(attentionCount(body, "AWAITING_MY_RESPONSE")).toBe(1);
    });

    it("14. an assigned, not-yet-picked-up shipment counts as Awaiting Pickup", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await loadBetween(s, s.origin, s.dest);
      await assignLoad(s, c, loadId);

      const body = await getSummary(c.cookie);
      expect(attentionCount(body, "AWAITING_PICKUP")).toBe(1);
      expect(body.overview.wonShipmentCount).toBe(1);
    });

    it("15. a picked-up shipment counts as Ready for Transit Update", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await loadBetween(s, s.origin, s.dest);
      await assignLoad(s, c, loadId);
      expect((await op(c.cookie, loadId, "pickup")).statusCode).toBe(200);

      const body = await getSummary(c.cookie);
      expect(attentionCount(body, "READY_FOR_TRANSIT_UPDATE")).toBe(1);
      expect(attentionCount(body, "AWAITING_PICKUP")).toBe(0);
    });

    it("16. an in-transit shipment counts as Awaiting Delivery Confirmation", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await loadBetween(s, s.origin, s.dest);
      await assignLoad(s, c, loadId);
      await op(c.cookie, loadId, "pickup");
      expect((await op(c.cookie, loadId, "in-transit")).statusCode).toBe(200);

      const body = await getSummary(c.cookie);
      expect(attentionCount(body, "AWAITING_DELIVERY_CONFIRMATION")).toBe(1);
    });

    it("17. a delivered shipment with no POD counts as POD Needed", async () => {
      const s = await shipper();
      const c = await carrier();
      await deliveredLoad(s, c, s.origin, s.dest);

      const body = await getSummary(c.cookie);
      expect(attentionCount(body, "POD_NEEDED")).toBe(1);
      expect(attentionCount(body, "REPLACEMENT_POD_NEEDED")).toBe(0);
    });

    it("18. a rejected POD counts as Replacement POD Needed for the carrier too", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await deliveredLoad(s, c, s.origin, s.dest);
      const docId = await uploadAndConfirmPod(c, loadId);
      expect((await reject(s.cookie, docId)).statusCode).toBe(200);

      const body = await getSummary(c.cookie);
      expect(attentionCount(body, "REPLACEMENT_POD_NEEDED")).toBe(1);
      expect(attentionCount(body, "POD_NEEDED")).toBe(0);
    });

    it("19. a carrier's summary never includes a load awarded to a different carrier", async () => {
      const s = await shipper();
      const cMine = await carrier("My Carrier");
      const cOther = await carrier("Other Carrier");
      const loadId = await loadBetween(s, s.origin, s.dest);
      await assignLoad(s, cOther, loadId);

      const body = await getSummary(cMine.cookie);
      expect(body.overview.wonShipmentCount).toBe(0);
      const ids = body.recentShipments.map((r: { id: string }) => r.id);
      expect(ids).not.toContain(loadId);
    });

    it("20. marketplace ineligibility is represented truthfully — never a fabricated zero", async () => {
      const c = await registerCompany(api, { type: "CARRIER", companyName: "Unverified Co" });

      const body = await getSummary(c.cookie);
      expect(body.marketplaceEligible).toBe(false);
      expect(body.overview.availableFreightCount).toBeNull();
    });
  });
});
