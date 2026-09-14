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

suite("Shipment Detail — unified next action, timeline privacy, RC agreement source (M4 Phase 6, integration)", () => {
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
    const origin = await createLocation(api, s.cookie, { name: "O", city: "Chicago", state: "IL" });
    const dest = await createLocation(api, s.cookie, { name: "D", city: "Dallas", state: "TX" });
    return { ...s, origin, dest };
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

  async function draftLoad(s: ShipperFx, over: Record<string, unknown> = {}): Promise<string> {
    const draft = await api.inject(
      authed(s.cookie, {
        method: "POST",
        url: "/api/loads",
        payload: {
          originLocationId: s.origin,
          destinationLocationId: s.dest,
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
    if (draft.statusCode !== 201) throw new Error(`draftLoad ${draft.statusCode}: ${draft.body}`);
    return draft.json().id;
  }

  /** Post -> negotiated offer -> shipper accepts. Auto-assigns atomically
   *  (Milestone 4 Phase 5) — no separate /assign call. */
  async function assignedLoadNegotiated(s: ShipperFx, c: Session, loadId?: string): Promise<string> {
    const id = loadId ?? (await draftLoad(s));
    await api.inject(authed(s.cookie, { method: "POST", url: `/api/loads/${id}/post` }));
    const offer = await api.inject(
      authed(c.cookie, {
        method: "POST",
        url: `/api/marketplace/loads/${id}/offers`,
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
    return id;
  }

  /** Post PUBLISH_RATE -> carrier books at the posted rate. Auto-assigns. */
  async function assignedLoadBooked(s: ShipperFx, c: Session): Promise<string> {
    const id = await draftLoad(s, { commercialMode: "PUBLISH_RATE", postedRate: "1200.00" });
    await api.inject(authed(s.cookie, { method: "POST", url: `/api/loads/${id}/post` }));
    const book = await api.inject(
      authed(c.cookie, {
        method: "POST",
        url: `/api/marketplace/loads/${id}/book`,
        payload: { confirmedRate: "1200.00" },
      }),
    );
    if (book.statusCode !== 200) throw new Error(`book ${book.statusCode}: ${book.body}`);
    return id;
  }

  const op = (cookie: string, loadId: string, verb: "pickup" | "in-transit" | "deliver") =>
    api.inject(authed(cookie, { method: "POST", url: `/api/loads/${loadId}/${verb}` }));

  async function uploadPod(c: Session, loadId: string): Promise<string> {
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
    api.inject(authed(cookie, { method: "POST", url: `/api/load-documents/${id}/reject`, payload: { reason: "wrong document" } }));

  const shipmentsForShipper = (s: Session) =>
    api.inject(authed(s.cookie, { method: "GET", url: "/api/loads/shipments" }));
  const shipmentsForCarrier = (c: Session) =>
    api.inject(authed(c.cookie, { method: "GET", url: "/api/marketplace/shipments" }));
  function rowFor(res: { json: () => { data: Array<{ id: string; nextAction: string }> } }, loadId: string) {
    const row = res.json().data.find((r) => r.id === loadId);
    if (!row) throw new Error("shipment row not found");
    return row;
  }

  // ── unified, POD-aware next-action across every shipment stage ────

  describe("shipment list next-action is POD-aware for both the shipper and carrier lists", () => {
    it("CARRIER_ASSIGNED", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await assignedLoadNegotiated(s, c);

      expect(rowFor(await shipmentsForShipper(s), loadId).nextAction).toBe("Awaiting pickup");
      expect(rowFor(await shipmentsForCarrier(c), loadId).nextAction).toBe("Confirm pickup");
    });

    it("PICKED_UP", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await assignedLoadNegotiated(s, c);
      await op(c.cookie, loadId, "pickup");

      expect(rowFor(await shipmentsForShipper(s), loadId).nextAction).toBe(
        "Picked up — awaiting transit update",
      );
      expect(rowFor(await shipmentsForCarrier(c), loadId).nextAction).toBe("Mark in transit");
    });

    it("IN_TRANSIT", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await assignedLoadNegotiated(s, c);
      await op(c.cookie, loadId, "pickup");
      await op(c.cookie, loadId, "in-transit");

      expect(rowFor(await shipmentsForShipper(s), loadId).nextAction).toBe("In transit");
      expect(rowFor(await shipmentsForCarrier(c), loadId).nextAction).toBe("Mark delivered");
    });

    it("DELIVERED, no POD uploaded yet", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await assignedLoadNegotiated(s, c);
      for (const v of ["pickup", "in-transit", "deliver"] as const) await op(c.cookie, loadId, v);

      expect(rowFor(await shipmentsForShipper(s), loadId).nextAction).toBe("Awaiting POD");
      expect(rowFor(await shipmentsForCarrier(c), loadId).nextAction).toBe("Upload POD");
    });

    it("DELIVERED, POD pending review", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await assignedLoadNegotiated(s, c);
      for (const v of ["pickup", "in-transit", "deliver"] as const) await op(c.cookie, loadId, v);
      await uploadPod(c, loadId);

      expect(rowFor(await shipmentsForShipper(s), loadId).nextAction).toBe("Review POD");
      expect(rowFor(await shipmentsForCarrier(c), loadId).nextAction).toBe(
        "Awaiting shipper POD review",
      );
    });

    it("DELIVERED, POD rejected (no replacement yet)", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await assignedLoadNegotiated(s, c);
      for (const v of ["pickup", "in-transit", "deliver"] as const) await op(c.cookie, loadId, v);
      const podId = await uploadPod(c, loadId);
      const rej = await reject(s.cookie, podId);
      expect(rej.statusCode).toBe(200);

      expect(rowFor(await shipmentsForShipper(s), loadId).nextAction).toBe(
        "Awaiting replacement POD",
      );
      expect(rowFor(await shipmentsForCarrier(c), loadId).nextAction).toBe(
        "Upload replacement POD",
      );
    });

    it("DELIVERED, POD approved — ready to complete", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await assignedLoadNegotiated(s, c);
      for (const v of ["pickup", "in-transit", "deliver"] as const) await op(c.cookie, loadId, v);
      const podId = await uploadPod(c, loadId);
      const app = await approve(s.cookie, podId);
      expect(app.statusCode).toBe(200);

      expect(rowFor(await shipmentsForShipper(s), loadId).nextAction).toBe("Complete shipment");
      expect(rowFor(await shipmentsForCarrier(c), loadId).nextAction).toBe(
        "POD approved — awaiting shipper completion",
      );
    });

    it("a rejected POD followed by an approved replacement resolves to the replacement's state, not the rejection", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await assignedLoadNegotiated(s, c);
      for (const v of ["pickup", "in-transit", "deliver"] as const) await op(c.cookie, loadId, v);
      const firstPod = await uploadPod(c, loadId);
      await reject(s.cookie, firstPod);
      const replacementPod = await uploadPod(c, loadId);
      await approve(s.cookie, replacementPod);

      expect(rowFor(await shipmentsForShipper(s), loadId).nextAction).toBe("Complete shipment");
    });

    it("COMPLETED", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await assignedLoadNegotiated(s, c);
      for (const v of ["pickup", "in-transit", "deliver"] as const) await op(c.cookie, loadId, v);
      const podId = await uploadPod(c, loadId);
      await approve(s.cookie, podId);
      const complete = await api.inject(
        authed(s.cookie, { method: "POST", url: `/api/loads/${loadId}/complete` }),
      );
      expect(complete.statusCode).toBe(200);

      expect(rowFor(await shipmentsForShipper(s), loadId).nextAction).toBe("Completed");
      expect(rowFor(await shipmentsForCarrier(c), loadId).nextAction).toBe("Completed");
    });
  });

  // ── LoadView carries the same deterministic next-action + shipper identity ──

  describe("LoadView.shipmentNextAction and shipperName", () => {
    it("matches the list's next-action for both viewers, and exposes the shipper's name to the carrier", async () => {
      const s = await shipper("Detail Shipper Co");
      const c = await carrier();
      const loadId = await assignedLoadNegotiated(s, c);

      const shipperView = await api.inject(
        authed(s.cookie, { method: "GET", url: `/api/loads/${loadId}` }),
      );
      const carrierView = await api.inject(
        authed(c.cookie, { method: "GET", url: `/api/loads/${loadId}` }),
      );
      expect(shipperView.json().shipmentNextAction).toBe("Awaiting pickup");
      expect(carrierView.json().shipmentNextAction).toBe("Confirm pickup");
      expect(carrierView.json().shipperName).toBe("Detail Shipper Co");
    });
  });

  // ── timeline privacy: a carrier must never learn a third party's identity ──

  describe("timeline privacy", () => {
    it("a losing/other carrier's identity is redacted from the WINNING carrier's timeline, but stays visible to the shipper", async () => {
      const s = await shipper();
      const firstOfferer = await carrier("First Carrier");
      const winner = await carrier("Winning Carrier");
      const loadId = await draftLoad(s);
      await api.inject(authed(s.cookie, { method: "POST", url: `/api/loads/${loadId}/post` }));

      // firstOfferer's offer flips POSTED -> OFFER_RECEIVED, authored by them.
      const firstOffer = await api.inject(
        authed(firstOfferer.cookie, {
          method: "POST",
          url: `/api/marketplace/loads/${loadId}/offers`,
          payload: { amount: "900.00", currency: "USD" },
        }),
      );
      expect(firstOffer.statusCode).toBe(201);

      // winner offers too and is the one the shipper accepts.
      const winnerOffer = await api.inject(
        authed(winner.cookie, {
          method: "POST",
          url: `/api/marketplace/loads/${loadId}/offers`,
          payload: { amount: "1000.00", currency: "USD" },
        }),
      );
      await api.inject(
        authed(s.cookie, {
          method: "POST",
          url: `/api/offers/rounds/${winnerOffer.json().rounds[0].id}/accept`,
        }),
      );

      const shipperEvents = (
        await api.inject(authed(s.cookie, { method: "GET", url: `/api/loads/${loadId}` }))
      ).json().events as Array<{ note: string | null; actorName: string | null; actorUserId: string | null }>;
      const winnerEvents = (
        await api.inject(authed(winner.cookie, { method: "GET", url: `/api/loads/${loadId}` }))
      ).json().events as Array<{ note: string | null; actorName: string | null; actorUserId: string | null }>;

      const receivedShipper = shipperEvents.find((e) => e.note === "first marketplace offer received");
      const receivedWinner = winnerEvents.find((e) => e.note === "first marketplace offer received");
      expect(receivedShipper).toBeDefined();
      expect(receivedWinner).toBeDefined();

      // The shipper — authorized to know everyone who acted on their own
      // load — sees the first offerer's real identity.
      expect(receivedShipper!.actorName).not.toBeNull();
      // The WINNING carrier, who is not a party to that other company's
      // action, must never learn who it was.
      expect(receivedWinner!.actorName).toBeNull();
      expect(receivedWinner!.actorUserId).toBeNull();
      // The event itself (that an offer was received) is still truthfully
      // present — only the third party's identity is redacted.
      expect(receivedWinner!.note).toBe("first marketplace offer received");
    });

    it("the winning carrier's OWN actions keep full attribution on their own timeline", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await assignedLoadBooked(s, c);

      const carrierEvents = (
        await api.inject(authed(c.cookie, { method: "GET", url: `/api/loads/${loadId}` }))
      ).json().events as Array<{ toStatus: string | null; actorName: string | null }>;
      const awarded = carrierEvents.find((e) => e.toStatus === "AWARDED");
      expect(awarded?.actorName).not.toBeNull();
    });
  });

  // ── Rate Confirmation agreement source ─────────────────────────────

  describe("Rate Confirmation agreement source", () => {
    it("a negotiated acceptance reports CARRIER_OFFER / 'Negotiated offer'", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await assignedLoadNegotiated(s, c);

      const rc = await api.inject(
        authed(s.cookie, { method: "GET", url: `/api/loads/${loadId}/rate-confirmation` }),
      );
      expect(rc.statusCode).toBe(200);
      expect(rc.json().agreementSource).toBe("CARRIER_OFFER");
    });

    it("Book at Posted Rate reports POSTED_RATE_BOOKING / 'Booked at posted rate'", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await assignedLoadBooked(s, c);

      const rc = await api.inject(
        authed(c.cookie, { method: "GET", url: `/api/loads/${loadId}/rate-confirmation` }),
      );
      expect(rc.statusCode).toBe(200);
      expect(rc.json().agreementSource).toBe("POSTED_RATE_BOOKING");
    });
  });

  // ── POD authority consistency: an active APPROVED POD must dominate the
  // read model even when a later, unrelated POD is uploaded afterward —
  // the exact contradiction found in the Phase 6 POD authority review.
  // Nothing here requires a "replacement" — POD B is a plain, independent
  // upload with no `replacedDocumentId`, which the existing upload rules
  // have always permitted regardless of POD A's review outcome. ──

  describe("POD authority consistency — an approved POD dominates a newer secondary POD", () => {
    async function getLoad(session: Session, loadId: string) {
      const res = await api.inject(
        authed(session.cookie, { method: "GET", url: `/api/loads/${loadId}` }),
      );
      if (res.statusCode !== 200) throw new Error(`GET load ${res.statusCode}: ${res.body}`);
      return res.json() as {
        completionReady: boolean;
        availableTransitions: string[];
        shipmentNextAction: string | null;
      };
    }

    it("APPROVED POD A, then a later PENDING_REVIEW POD B: completion stays ready, next action stays 'complete', and /complete still succeeds", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await assignedLoadNegotiated(s, c);
      for (const v of ["pickup", "in-transit", "deliver"] as const) await op(c.cookie, loadId, v);

      const podA = await uploadPod(c, loadId);
      expect((await approve(s.cookie, podA)).statusCode).toBe(200);

      // A second, wholly independent POD — no replacedDocumentId, exactly as
      // the existing upload rules already permit at any time before COMPLETED.
      await uploadPod(c, loadId);

      const shipperView = await getLoad(s, loadId);
      expect(shipperView.completionReady).toBe(true);
      expect(shipperView.availableTransitions).toContain("COMPLETED");
      expect(shipperView.shipmentNextAction).toBe("Complete shipment");

      const carrierView = await getLoad(c, loadId);
      expect(carrierView.shipmentNextAction).toBe("POD approved — awaiting shipper completion");

      expect(rowFor(await shipmentsForShipper(s), loadId).nextAction).toBe("Complete shipment");
      expect(rowFor(await shipmentsForCarrier(c), loadId).nextAction).toBe(
        "POD approved — awaiting shipper completion",
      );

      const complete = await api.inject(
        authed(s.cookie, { method: "POST", url: `/api/loads/${loadId}/complete` }),
      );
      expect(complete.statusCode).toBe(200);
    });

    it("APPROVED POD A, then a later REJECTED POD B: completion stays ready without requiring a replacement for B", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await assignedLoadNegotiated(s, c);
      for (const v of ["pickup", "in-transit", "deliver"] as const) await op(c.cookie, loadId, v);

      const podA = await uploadPod(c, loadId);
      expect((await approve(s.cookie, podA)).statusCode).toBe(200);

      const podB = await uploadPod(c, loadId);
      expect((await reject(s.cookie, podB)).statusCode).toBe(200);

      const shipperView = await getLoad(s, loadId);
      expect(shipperView.completionReady).toBe(true);
      expect(shipperView.availableTransitions).toContain("COMPLETED");
      expect(shipperView.shipmentNextAction).toBe("Complete shipment");

      const carrierView = await getLoad(c, loadId);
      expect(carrierView.shipmentNextAction).toBe("POD approved — awaiting shipper completion");

      expect(rowFor(await shipmentsForShipper(s), loadId).nextAction).toBe("Complete shipment");
      expect(rowFor(await shipmentsForCarrier(c), loadId).nextAction).toBe(
        "POD approved — awaiting shipper completion",
      );

      const complete = await api.inject(
        authed(s.cookie, { method: "POST", url: `/api/loads/${loadId}/complete` }),
      );
      expect(complete.statusCode).toBe(200);
    });
  });
});
