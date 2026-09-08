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
  SESSION_COOKIE,
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

suite("Slice 6A hardening — document manage-permission + actor-aware transitions", () => {
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

  /** Add a second member to `company` with an explicit role, log them in, and
   *  switch them into that company. Returns their session (cookie + companyId). */
  let memberSeq = 0;
  async function memberOf(company: Session, role: "SHIPPER" | "CARRIER"): Promise<Session> {
    memberSeq += 1;
    const email = `member${memberSeq}@it.test`;
    await registerCompany(api, { email });
    const added = await api.inject(
      authed(company.cookie, {
        method: "POST",
        url: `/api/companies/${company.companyId}/members`,
        payload: { email, role },
      }),
    );
    if (added.statusCode !== 201) throw new Error(`addMember ${added.statusCode}: ${added.body}`);
    const login = await api.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "integration-test-password" },
    });
    const cookie = login.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
    await api.inject(
      authed(cookie, {
        method: "POST",
        url: "/api/auth/switch-company",
        payload: { companyId: company.companyId },
      }),
    );
    return { cookie, userId: login.json().user.id, companyId: company.companyId, email };
  }

  async function assignedLoad(s: ShipperFx, c: Session): Promise<string> {
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
    return loadId;
  }

  const reqUpload = (cookie: string, loadId: string, over: Record<string, unknown> = {}) =>
    api.inject(
      authed(cookie, {
        method: "POST",
        url: `/api/loads/${loadId}/documents`,
        payload: {
          documentType: "BOL",
          originalFilename: "d.pdf",
          contentType: "application/pdf",
          sizeBytes: 64,
          ...over,
        },
      }),
    );
  const confirm = (cookie: string, id: string) =>
    api.inject(authed(cookie, { method: "POST", url: `/api/load-documents/${id}/confirm` }));
  const removeDoc = (cookie: string, id: string) =>
    api.inject(authed(cookie, { method: "DELETE", url: `/api/load-documents/${id}` }));

  async function intent(cookie: string, loadId: string, over: Record<string, unknown> = {}) {
    const r = await reqUpload(cookie, loadId, over);
    if (r.statusCode !== 201) throw new Error(`reqUpload ${r.statusCode}: ${r.body}`);
    const id = r.json().document.id;
    fake.simulateUpload(`loads/${loadId}/documents/${id}`, new Uint8Array(64), "application/pdf");
    return id;
  }

  const uploadedEvents = (loadId: string) =>
    prisma.loadEvent.count({
      where: { loadId, type: { in: ["DOCUMENT_UPLOADED", "DOCUMENT_REMOVED"] } },
    });

  // ── ISSUE 1: confirm / remove need the upload-side permission ──────

  it("another user in the SAME uploading company may confirm — but only if they hold the upload permission", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);

    // shipper-created intent
    const shipDoc = await intent(s.cookie, loadId, { documentType: "BOL" });
    const shipPeer = await memberOf(s, "SHIPPER"); // has LOAD_UPDATE_OWN
    const shipCarrierRole = await memberOf(s, "CARRIER"); // same company, no LOAD_UPDATE_OWN

    const denied = await confirm(shipCarrierRole.cookie, shipDoc);
    expect(denied.statusCode).toBe(403);
    // state unchanged, no event
    expect(
      (await prisma.loadDocument.findUniqueOrThrow({ where: { id: shipDoc } })).confirmedAt,
    ).toBeNull();
    expect(await uploadedEvents(loadId)).toBe(0);

    expect((await confirm(shipPeer.cookie, shipDoc)).statusCode).toBe(200);
    expect(await uploadedEvents(loadId)).toBe(1);

    // carrier-created intent
    const carDoc = await intent(c.cookie, loadId, { documentType: "POD", sizeBytes: 64 });
    const carPeer = await memberOf(c, "CARRIER"); // has SHIPMENT_OPERATE_ASSIGNED
    const carShipperRole = await memberOf(c, "SHIPPER"); // same carrier company, no SHIPMENT_OPERATE_ASSIGNED

    expect((await confirm(carShipperRole.cookie, carDoc)).statusCode).toBe(403);
    expect(
      (await prisma.loadDocument.findUniqueOrThrow({ where: { id: carDoc } })).confirmedAt,
    ).toBeNull();

    expect((await confirm(carPeer.cookie, carDoc)).statusCode).toBe(200);
  });

  it("DELETE follows the same rule — company scope alone is insufficient", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);

    // confirmed BOL uploaded by the shipper
    const doc = await intent(s.cookie, loadId, { documentType: "BOL" });
    await confirm(s.cookie, doc);

    const wrongRole = await memberOf(s, "CARRIER");
    const denied = await removeDoc(wrongRole.cookie, doc);
    expect(denied.statusCode).toBe(403);
    expect(
      (await prisma.loadDocument.findUniqueOrThrow({ where: { id: doc } })).removedAt,
    ).toBeNull();
    expect(await prisma.loadEvent.count({ where: { loadId, type: "DOCUMENT_REMOVED" } })).toBe(0);

    const rightRole = await memberOf(s, "SHIPPER");
    expect((await removeDoc(rightRole.cookie, doc)).statusCode).toBe(200);
    expect(
      (await prisma.loadDocument.findUniqueOrThrow({ where: { id: doc } })).removedAt,
    ).not.toBeNull();
  });

  it("the OTHER party and a cross-company user still cannot confirm/remove (404 / 403 as before)", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);
    const doc = await intent(c.cookie, loadId, { documentType: "POD", sizeBytes: 64 });

    // the shipper is on the load but is not the uploading company → 403
    expect((await confirm(s.cookie, doc)).statusCode).toBe(403);
    // a completely unrelated carrier → 404 (cannot even read the load)
    const outsider = await carrier("Outsider Co");
    expect((await confirm(outsider.cookie, doc)).statusCode).toBe(404);

    expect(
      (await prisma.loadDocument.findUniqueOrThrow({ where: { id: doc } })).confirmedAt,
    ).toBeNull();
  });

  // ── ISSUE 2: availableTransitions is actor-aware ──────────────────

  const view = (cookie: string, loadId: string) =>
    api.inject(authed(cookie, { method: "GET", url: `/api/loads/${loadId}` }));

  async function podApproved(s: ShipperFx, c: Session, loadId: string) {
    const r = await reqUpload(c.cookie, loadId, { documentType: "POD", sizeBytes: 64 });
    const id = r.json().document.id;
    fake.simulateUpload(`loads/${loadId}/documents/${id}`, new Uint8Array(64), "application/pdf");
    await confirm(c.cookie, id);
    await api.inject(
      authed(s.cookie, { method: "POST", url: `/api/load-documents/${id}/approve` }),
    );
  }

  it("carrier-only movement transitions are advertised to the carrier, never to the shipper", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);

    const check = async (expectCarrier: string, absentForShipper: string[]) => {
      const cv = await view(c.cookie, loadId);
      const sv = await view(s.cookie, loadId);
      expect(cv.json().availableTransitions).toContain(expectCarrier);
      for (const t of absentForShipper) {
        expect(sv.json().availableTransitions, `shipper @ ${t}`).not.toContain(t);
      }
    };

    await check("PICKED_UP", ["PICKED_UP"]);
    await api.inject(authed(c.cookie, { method: "POST", url: `/api/loads/${loadId}/pickup` }));
    await check("IN_TRANSIT", ["IN_TRANSIT"]);
    await api.inject(authed(c.cookie, { method: "POST", url: `/api/loads/${loadId}/in-transit` }));
    await check("DELIVERED", ["DELIVERED"]);
    await api.inject(authed(c.cookie, { method: "POST", url: `/api/loads/${loadId}/deliver` }));

    // shipper still sees its own action (cancel unreachable in motion; nothing carrier-only)
    const svAssigned = await view(s.cookie, loadId);
    expect(svAssigned.json().availableTransitions).not.toContain("PICKED_UP");
  });

  it("COMPLETED is advertised to the owning shipper only, and only when completionReady", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);
    for (const v of ["pickup", "in-transit", "deliver"]) {
      await api.inject(authed(c.cookie, { method: "POST", url: `/api/loads/${loadId}/${v}` }));
    }

    // DELIVERED, no approved POD
    let sv = await view(s.cookie, loadId);
    let cv = await view(c.cookie, loadId);
    expect(sv.json().completionReady).toBe(false);
    expect(sv.json().availableTransitions).not.toContain("COMPLETED");
    expect(cv.json().completionReady).toBe(false);
    expect(cv.json().availableTransitions).not.toContain("COMPLETED");

    await podApproved(s, c, loadId);

    sv = await view(s.cookie, loadId);
    cv = await view(c.cookie, loadId);
    // completionReady is objective — true for BOTH readers
    expect(sv.json().completionReady).toBe(true);
    expect(cv.json().completionReady).toBe(true);
    // ...but only the shipper is offered the action
    expect(sv.json().availableTransitions).toContain("COMPLETED");
    expect(cv.json().availableTransitions).not.toContain("COMPLETED");

    // enforcement is unchanged: the carrier calling /complete is still 403
    expect(
      (await api.inject(authed(c.cookie, { method: "POST", url: `/api/loads/${loadId}/complete` })))
        .statusCode,
    ).toBe(403);
  });

  it("the dormant AWARDED -> POSTED transition stays non-executable", async () => {
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
    // AWARDED — no endpoint moves it back to POSTED; unpost is DRAFT-targeted and 409s here
    const unpost = await api.inject(
      authed(s.cookie, { method: "POST", url: `/api/loads/${loadId}/unpost` }),
    );
    expect(unpost.statusCode).toBe(409);
    expect((await prisma.load.findUniqueOrThrow({ where: { id: loadId } })).status).toBe("AWARDED");
  });
});
