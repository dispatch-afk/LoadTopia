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

suite("shipment completion (integration)", () => {
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

  async function deliveredLoad(s: ShipperFx, c: Session): Promise<string> {
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
        },
      }),
    );
    const loadId = draft.json().id;
    await api.inject(authed(s.cookie, { method: "POST", url: `/api/loads/${loadId}/post` }));
    const offer = await api.inject(
      authed(c.cookie, {
        method: "POST",
        url: `/api/marketplace/loads/${loadId}/offers`,
        payload: { amount: "1000.00", currency: "USD" },
      }),
    );
    await api.inject(
      authed(s.cookie, {
        method: "POST",
        url: `/api/offers/rounds/${offer.json().rounds[0].id}/accept`,
      }),
    );
    await api.inject(authed(s.cookie, { method: "POST", url: `/api/loads/${loadId}/assign` }));
    for (const v of ["pickup", "in-transit", "deliver"]) {
      await api.inject(authed(c.cookie, { method: "POST", url: `/api/loads/${loadId}/${v}` }));
    }
    return loadId;
  }

  async function uploadDoc(
    c: Session,
    loadId: string,
    documentType: "BOL" | "POD" | "OTHER",
    confirmIt = true,
  ): Promise<string> {
    const size = 128;
    const r = await api.inject(
      authed(c.cookie, {
        method: "POST",
        url: `/api/loads/${loadId}/documents`,
        payload: {
          documentType,
          originalFilename: "d.pdf",
          contentType: "application/pdf",
          sizeBytes: size,
        },
      }),
    );
    const id = r.json().document.id;
    if (confirmIt) {
      fake.simulateUpload(
        `loads/${loadId}/documents/${id}`,
        new Uint8Array(size),
        "application/pdf",
      );
      await api.inject(
        authed(c.cookie, { method: "POST", url: `/api/load-documents/${id}/confirm` }),
      );
    }
    return id;
  }

  const approvedPod = async (s: ShipperFx, c: Session, loadId: string): Promise<string> => {
    const id = await uploadDoc(c, loadId, "POD");
    const res = await api.inject(
      authed(s.cookie, { method: "POST", url: `/api/load-documents/${id}/approve` }),
    );
    if (res.statusCode !== 200) throw new Error(`approve ${res.statusCode}: ${res.body}`);
    return id;
  };

  const complete = (cookie: string, loadId: string) =>
    api.inject(authed(cookie, { method: "POST", url: `/api/loads/${loadId}/complete` }));

  // ── readiness matrix ───────────────────────────────────────────

  it("DELIVERED cannot complete without an active APPROVED POD", async () => {
    const s = await shipper();
    const c = await carrier();

    // no POD
    const l0 = await deliveredLoad(s, c);
    expect((await complete(s.cookie, l0)).json().error.code).toBe("COMPLETION_NOT_READY");

    // unconfirmed POD
    const l1 = await deliveredLoad(s, c);
    await uploadDoc(c, l1, "POD", false);
    expect((await complete(s.cookie, l1)).statusCode).toBe(409);

    // PENDING_REVIEW POD
    const l2 = await deliveredLoad(s, c);
    await uploadDoc(c, l2, "POD");
    expect((await complete(s.cookie, l2)).statusCode).toBe(409);

    // REJECTED POD
    const l3 = await deliveredLoad(s, c);
    const rej = await uploadDoc(c, l3, "POD");
    await api.inject(
      authed(s.cookie, {
        method: "POST",
        url: `/api/load-documents/${rej}/reject`,
        payload: { reason: "bad" },
      }),
    );
    expect((await complete(s.cookie, l3)).statusCode).toBe(409);

    // BOL only / OTHER only
    const l4 = await deliveredLoad(s, c);
    await uploadDoc(c, l4, "BOL");
    await uploadDoc(c, l4, "OTHER");
    expect((await complete(s.cookie, l4)).statusCode).toBe(409);

    for (const l of [l0, l1, l2, l3, l4]) {
      expect((await prisma.load.findUniqueOrThrow({ where: { id: l } })).status).toBe("DELIVERED");
    }
  });

  it("DELIVERED + an active APPROVED POD → the owning shipper completes; the carrier cannot", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await deliveredLoad(s, c);
    await approvedPod(s, c, loadId);

    // carrier: 403 at the permission gate (no load:update:own)
    expect((await complete(c.cookie, loadId)).statusCode).toBe(403);
    // cross-company shipper: 404
    const other = await shipper("Rival Foods");
    expect((await complete(other.cookie, loadId)).statusCode).toBe(404);

    const res = await complete(s.cookie, loadId);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("COMPLETED");
    expect(res.json().completedAt).toBeTruthy();

    const load = await prisma.load.findUniqueOrThrow({ where: { id: loadId } });
    expect(load.status).toBe("COMPLETED");
    expect(load.completedAt).not.toBeNull();

    const events = await prisma.loadEvent.findMany({
      where: { loadId, type: "STATUS_CHANGED", toStatus: "COMPLETED" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.fromStatus).toBe("DELIVERED");
    expect(events[0]!.actorUserId).toBe(s.userId);
    expect(events[0]!.actorCompanyId).toBe(s.companyId);
  });

  it("cannot complete a load that is not DELIVERED", async () => {
    const s = await shipper();
    const c = await carrier();
    const draft = await api.inject(
      authed(s.cookie, {
        method: "POST",
        url: "/api/loads",
        payload: {
          originLocationId: s.origin,
          destinationLocationId: s.dest,
          equipmentType: "DRY_VAN",
          mode: "FTL",
          commodity: "g",
          weightLbs: 1,
          pickupWindowStart: future(3),
          pickupWindowEnd: future(3, 16),
          deliveryWindowStart: future(5),
          deliveryWindowEnd: future(5, 17),
        },
      }),
    );
    const loadId = draft.json().id;
    await api.inject(authed(s.cookie, { method: "POST", url: `/api/loads/${loadId}/post` }));
    const offer = await api.inject(
      authed(c.cookie, {
        method: "POST",
        url: `/api/marketplace/loads/${loadId}/offers`,
        payload: { amount: "10.00", currency: "USD" },
      }),
    );
    await api.inject(
      authed(s.cookie, {
        method: "POST",
        url: `/api/offers/rounds/${offer.json().rounds[0].id}/accept`,
      }),
    );
    await api.inject(authed(s.cookie, { method: "POST", url: `/api/loads/${loadId}/assign` }));
    await api.inject(authed(c.cookie, { method: "POST", url: `/api/loads/${loadId}/pickup` }));

    const res = await complete(s.cookie, loadId); // PICKED_UP
    expect(res.statusCode).toBe(409);
    expect((await prisma.load.findUniqueOrThrow({ where: { id: loadId } })).status).toBe(
      "PICKED_UP",
    );
  });

  it("concurrent complete → exactly one success, one 409, completed_at + event once", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await deliveredLoad(s, c);
    await approvedPod(s, c, loadId);

    const [a, b] = await Promise.all([complete(s.cookie, loadId), complete(s.cookie, loadId)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);

    expect(
      await prisma.loadEvent.count({
        where: { loadId, type: "STATUS_CHANGED", toStatus: "COMPLETED" },
      }),
    ).toBe(1);
  });

  it("a soft-removed APPROVED POD does not satisfy readiness (removed_at defense-in-depth)", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await deliveredLoad(s, c);
    const podId = await approvedPod(s, c, loadId);

    // the API refuses to remove a reviewed POD — force it directly to prove the
    // completion query's `removed_at IS NULL` predicate is load-bearing.
    await prisma.loadDocument.update({ where: { id: podId }, data: { removedAt: new Date() } });

    expect((await complete(s.cookie, loadId)).json().error.code).toBe("COMPLETION_NOT_READY");
  });

  // ── independence ───────────────────────────────────────────────

  it("completion is a pure DB check — it succeeds during a storage outage and makes no storage call", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await deliveredLoad(s, c);
    await approvedPod(s, c, loadId);

    // Any StorageProvider call under outage throws → would surface as 503.
    fake.simulateOutage();
    const res = await complete(s.cookie, loadId);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("COMPLETED");
  });

  it("Rate Confirmation status does not affect completion; completion does not mutate it", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await deliveredLoad(s, c);
    await approvedPod(s, c, loadId);
    await prisma.rateConfirmation.updateMany({ where: { loadId }, data: { status: "FAILED" } });
    const rcBefore = await prisma.rateConfirmation.findUniqueOrThrow({ where: { loadId } });

    expect((await complete(s.cookie, loadId)).statusCode).toBe(200);
    expect(await prisma.rateConfirmation.findUniqueOrThrow({ where: { loadId } })).toEqual(
      rcBefore,
    );
  });

  it("a historical DELIVERED load (no Rate Confirmation, no M3 events) completes once a new POD is approved", async () => {
    const s = await shipper();
    const c = await carrier();
    const draft = await api.inject(
      authed(s.cookie, {
        method: "POST",
        url: "/api/loads",
        payload: {
          originLocationId: s.origin,
          destinationLocationId: s.dest,
          equipmentType: "DRY_VAN",
          mode: "FTL",
          commodity: "g",
          weightLbs: 1,
          pickupWindowStart: future(3),
          pickupWindowEnd: future(3, 16),
          deliveryWindowStart: future(5),
          deliveryWindowEnd: future(5, 17),
        },
      }),
    );
    const loadId = draft.json().id;
    await api.inject(authed(s.cookie, { method: "POST", url: `/api/loads/${loadId}/post` }));
    const offer = await api.inject(
      authed(c.cookie, {
        method: "POST",
        url: `/api/marketplace/loads/${loadId}/offers`,
        payload: { amount: "10.00", currency: "USD" },
      }),
    );
    // Drive straight to DELIVERED without accept()/assign()/lifecycle endpoints →
    // no rate_confirmations row, no M3 events.
    await prisma.$transaction(async (tx) => {
      await tx.load.update({
        where: { id: loadId },
        data: {
          status: "DELIVERED",
          carrierCompanyId: c.companyId,
          awardedOfferRoundId: offer.json().rounds[0].id,
          bookedRate: "10.00",
          awardedAt: new Date(),
          assignedAt: new Date(),
          deliveredAt: new Date(),
        },
      });
      await tx.offerThread.update({
        where: { id: offer.json().threadId },
        data: { status: "ACCEPTED", closedAt: new Date() },
      });
    });
    expect(await prisma.rateConfirmation.count({ where: { loadId } })).toBe(0);

    await approvedPod(s, c, loadId);
    expect((await complete(s.cookie, loadId)).statusCode).toBe(200);
    expect((await prisma.load.findUniqueOrThrow({ where: { id: loadId } })).status).toBe(
      "COMPLETED",
    );
  });

  // ── availableTransitions ───────────────────────────────────────

  it("COMPLETED is advertised only when completion would actually succeed", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await deliveredLoad(s, c);

    const beforePod = await api.inject(
      authed(s.cookie, { method: "GET", url: `/api/loads/${loadId}` }),
    );
    expect(beforePod.json().completionReady).toBe(false);
    expect(beforePod.json().availableTransitions).not.toContain("COMPLETED");

    await approvedPod(s, c, loadId);
    const afterPod = await api.inject(
      authed(s.cookie, { method: "GET", url: `/api/loads/${loadId}` }),
    );
    expect(afterPod.json().completionReady).toBe(true);
    expect(afterPod.json().availableTransitions).toContain("COMPLETED");

    // an earlier status is never completion-ready
    const s2 = await shipper("Two");
    const draft = await api.inject(
      authed(s2.cookie, {
        method: "POST",
        url: "/api/loads",
        payload: {
          originLocationId: s2.origin,
          destinationLocationId: s2.dest,
          equipmentType: "DRY_VAN",
          mode: "FTL",
          commodity: "g",
          weightLbs: 1,
          pickupWindowStart: future(3),
          pickupWindowEnd: future(3, 16),
          deliveryWindowStart: future(5),
          deliveryWindowEnd: future(5, 17),
        },
      }),
    );
    const early = draft.json().id;
    const earlyView = await api.inject(
      authed(s2.cookie, { method: "GET", url: `/api/loads/${early}` }),
    );
    expect(earlyView.json().completionReady).toBe(false);
  });
});
