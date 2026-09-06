import type { PrismaClient } from "@loadtopia/db";
import { FakeStorageProvider } from "@loadtopia/providers";
import { MAX_OPERATIONAL_DOCUMENT_BYTES } from "@loadtopia/shared";
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

suite("operational documents (integration)", () => {
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
          weightLbs: 38000,
          pickupWindowStart: future(3, 8),
          pickupWindowEnd: future(3, 16),
          deliveryWindowStart: future(5, 8),
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
        payload: { amount: "1850.00", currency: "USD" },
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

  const reqUpload = (cookie: string, loadId: string, body: Record<string, unknown>) =>
    api.inject(
      authed(cookie, { method: "POST", url: `/api/loads/${loadId}/documents`, payload: body }),
    );

  const confirm = (cookie: string, documentId: string) =>
    api.inject(
      authed(cookie, { method: "POST", url: `/api/load-documents/${documentId}/confirm` }),
    );

  const listDocs = (cookie: string, loadId: string) =>
    api.inject(authed(cookie, { method: "GET", url: `/api/loads/${loadId}/documents` }));

  const download = (cookie: string, documentId: string) =>
    api.inject(
      authed(cookie, { method: "GET", url: `/api/load-documents/${documentId}/download` }),
    );

  const POD = (over: Record<string, unknown> = {}) => ({
    documentType: "POD",
    originalFilename: "signed-pod.pdf",
    contentType: "application/pdf",
    sizeBytes: 2048,
    ...over,
  });

  /** Request → simulate the browser upload → confirm. Returns the document id. */
  async function uploadAndConfirm(
    cookie: string,
    loadId: string,
    body: Record<string, unknown>,
    actualSize?: number,
    actualContentType?: string,
  ): Promise<{ id: string; storageKey: string }> {
    const r = await reqUpload(cookie, loadId, body);
    if (r.statusCode !== 201) throw new Error(`reqUpload ${r.statusCode}: ${r.body}`);
    const id = r.json().document.id;
    const storageKey = `loads/${loadId}/documents/${id}`;
    fake.simulateUpload(
      storageKey,
      new Uint8Array(actualSize ?? (body.sizeBytes as number)),
      actualContentType ?? (body.contentType as string),
    );
    const c = await confirm(cookie, id);
    if (c.statusCode !== 200) throw new Error(`confirm ${c.statusCode}: ${c.body}`);
    return { id, storageKey };
  }

  // ── upload request ───────────────────────────────────────────────

  it("both the assigned carrier and the owning shipper can request BOL / POD / OTHER uploads", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);

    for (const actor of [c, s]) {
      for (const documentType of ["BOL", "POD", "OTHER"]) {
        const res = await reqUpload(actor.cookie, loadId, POD({ documentType }));
        expect(res.statusCode, `${actor.email} ${documentType}`).toBe(201);
        expect(res.json().document.status).toBe("PENDING");
        expect(res.json().document.docType).toBe(documentType);
        // server-generated deterministic key namespace; filename is NOT identity
        expect(res.json().upload.url).toBeTruthy();
        expect(res.json().upload.maxBytes).toBe(MAX_OPERATIONAL_DOCUMENT_BYTES);
      }
    }
    // the signed upload the FAKE issued used the server key + exact contentType + maxBytes
    const last = fake.signedUploads.at(-1)!;
    expect(last.key).toMatch(/^loads\/[0-9a-f-]{36}\/documents\/[0-9a-f-]{36}$/);
    expect(last.key).not.toContain("signed-pod.pdf");
    expect(last.maxBytes).toBe(MAX_OPERATIONAL_DOCUMENT_BYTES);
  });

  it("an unrelated shipper and a losing carrier cannot request an upload (404, IDOR-safe)", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);
    const otherShipper = await shipper("Rival Foods");
    const loser = await carrier("Loser Co");

    expect((await reqUpload(otherShipper.cookie, loadId, POD())).statusCode).toBe(404);
    expect((await reqUpload(loser.cookie, loadId, POD())).statusCode).toBe(404);
    expect(await prisma.loadDocument.count({ where: { loadId } })).toBe(0);
  });

  it("upload request is blocked outside the operational window (AWARDED, and once COMPLETED)", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);

    // AWARDED: roll the load back via a fresh un-assigned load
    const s2 = await shipper("Two");
    const c2 = await carrier("Two Co");
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
    const awardedId = draft.json().id;
    await api.inject(authed(s2.cookie, { method: "POST", url: `/api/loads/${awardedId}/post` }));
    const offer = await api.inject(
      authed(c2.cookie, {
        method: "POST",
        url: `/api/marketplace/loads/${awardedId}/offers`,
        payload: { amount: "100.00", currency: "USD" },
      }),
    );
    await api.inject(
      authed(s2.cookie, {
        method: "POST",
        url: `/api/offers/rounds/${offer.json().rounds[0].id}/accept`,
      }),
    );
    expect((await reqUpload(c2.cookie, awardedId, POD())).statusCode).toBe(403); // AWARDED, carrier not operational

    // COMPLETED (forced): frozen
    await prisma.load.update({
      where: { id: loadId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    expect((await reqUpload(c.cookie, loadId, POD())).statusCode).toBe(409);
  });

  // ── confirm ──────────────────────────────────────────────────────

  it("confirm requires the object to exist and to EXACTLY match the declared size (Decision 2)", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);

    // missing object
    const r1 = await reqUpload(c.cookie, loadId, POD({ sizeBytes: 1000 }));
    expect((await confirm(c.cookie, r1.json().document.id)).statusCode).toBe(409);

    // actual 1 byte smaller
    const r2 = await reqUpload(c.cookie, loadId, POD({ sizeBytes: 1000 }));
    fake.simulateUpload(
      `loads/${loadId}/documents/${r2.json().document.id}`,
      new Uint8Array(999),
      "application/pdf",
    );
    const c2 = await confirm(c.cookie, r2.json().document.id);
    expect(c2.statusCode).toBe(409);
    expect(c2.json().error.code).toBe("DOCUMENT_SIZE_MISMATCH");

    // actual 1 byte larger
    const r3 = await reqUpload(c.cookie, loadId, POD({ sizeBytes: 1000 }));
    fake.simulateUpload(
      `loads/${loadId}/documents/${r3.json().document.id}`,
      new Uint8Array(1001),
      "application/pdf",
    );
    expect((await confirm(c.cookie, r3.json().document.id)).json().error.code).toBe(
      "DOCUMENT_SIZE_MISMATCH",
    );

    // exact match → confirmed
    const r4 = await reqUpload(c.cookie, loadId, POD({ sizeBytes: 1000 }));
    fake.simulateUpload(
      `loads/${loadId}/documents/${r4.json().document.id}`,
      new Uint8Array(1000),
      "application/pdf",
    );
    const c4 = await confirm(c.cookie, r4.json().document.id);
    expect(c4.statusCode).toBe(200);
    expect(c4.json().status).toBe("CONFIRMED");
    expect(c4.json().sizeBytes).toBe(1000);

    // none of the failed confirmations left a confirmed row
    const rows = await prisma.loadDocument.findMany({ where: { loadId } });
    expect(rows.filter((d) => d.confirmedAt !== null)).toHaveLength(1);
  });

  it("confirm rejects an object stored with the wrong content type", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);
    const r = await reqUpload(c.cookie, loadId, POD({ sizeBytes: 500 }));
    fake.simulateUpload(
      `loads/${loadId}/documents/${r.json().document.id}`,
      new Uint8Array(500),
      "text/html",
    );
    const res = await confirm(c.cookie, r.json().document.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("DOCUMENT_CONTENT_TYPE_MISMATCH");
  });

  it("a declared size over 25 MiB is rejected at request; an actual object over 25 MiB is rejected at confirm", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);

    expect(
      (await reqUpload(c.cookie, loadId, POD({ sizeBytes: MAX_OPERATIONAL_DOCUMENT_BYTES + 1 })))
        .statusCode,
    ).toBe(400);

    // exactly the max is allowed as a declared size...
    const r = await reqUpload(c.cookie, loadId, POD({ sizeBytes: MAX_OPERATIONAL_DOCUMENT_BYTES }));
    expect(r.statusCode).toBe(201);
    // ...but if the store somehow holds more, confirm rejects it
    fake.simulateUpload(
      `loads/${loadId}/documents/${r.json().document.id}`,
      new Uint8Array(MAX_OPERATIONAL_DOCUMENT_BYTES + 10),
      "application/pdf",
    );
    const res = await confirm(c.cookie, r.json().document.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("DOCUMENT_TOO_LARGE");
  });

  it("confirming a POD moves it to PENDING_REVIEW; BOL/OTHER get no review status", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);

    const pod = await uploadAndConfirm(c.cookie, loadId, POD({ sizeBytes: 100 }), 100);
    const bol = await uploadAndConfirm(
      c.cookie,
      loadId,
      POD({ documentType: "BOL", sizeBytes: 100 }),
      100,
    );

    const podRow = await prisma.loadDocument.findUniqueOrThrow({ where: { id: pod.id } });
    const bolRow = await prisma.loadDocument.findUniqueOrThrow({ where: { id: bol.id } });
    expect(podRow.reviewStatus).toBe("PENDING_REVIEW");
    expect(bolRow.reviewStatus).toBeNull();
    expect(podRow.confirmedAt).not.toBeNull();

    // uploader attribution captured
    expect(podRow.uploadedByUserId).toBe(c.userId);
    expect(podRow.uploadedByCompanyId).toBe(c.companyId);

    // exactly one DOCUMENT_UPLOADED event per confirmed doc
    const events = await prisma.loadEvent.findMany({
      where: { loadId, type: "DOCUMENT_UPLOADED" },
    });
    expect(events).toHaveLength(2);
    expect(events.map((e) => (e.data as { documentId: string }).documentId).sort()).toEqual(
      [pod.id, bol.id].sort(),
    );
    for (const e of events) {
      expect(e.actorUserId).toBe(c.userId);
      expect(e.actorCompanyId).toBe(c.companyId);
    }
  });

  it("confirm is idempotent and is denied to a company other than the requester", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);

    const r = await reqUpload(c.cookie, loadId, POD({ sizeBytes: 300 }));
    const id = r.json().document.id;
    fake.simulateUpload(`loads/${loadId}/documents/${id}`, new Uint8Array(300), "application/pdf");

    // the shipper did not request this upload → cannot confirm it
    expect((await confirm(s.cookie, id)).statusCode).toBe(403);

    expect((await confirm(c.cookie, id)).statusCode).toBe(200);
    expect((await confirm(c.cookie, id)).statusCode).toBe(200); // idempotent
    expect(await prisma.loadEvent.count({ where: { loadId, type: "DOCUMENT_UPLOADED" } })).toBe(1);
  });

  // ── list / download ─────────────────────────────────────────────

  it("list returns confirmed documents only — never a pending upload intent", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);

    await reqUpload(c.cookie, loadId, POD({ documentType: "BOL", sizeBytes: 10 })); // pending, never confirmed
    const confirmed = await uploadAndConfirm(c.cookie, loadId, POD({ sizeBytes: 20 }), 20);

    for (const cookie of [s.cookie, c.cookie]) {
      const list = await listDocs(cookie, loadId);
      expect(list.statusCode).toBe(200);
      expect(list.json().data.map((d: { id: string }) => d.id)).toEqual([confirmed.id]);
    }
    // an outsider cannot list
    const outsider = await carrier("Outsider Co");
    expect((await listDocs(outsider.cookie, loadId)).statusCode).toBe(404);
  });

  it("download returns a short-lived signed URL for a confirmed doc; not for a pending one or a missing object", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);

    const doc = await uploadAndConfirm(c.cookie, loadId, POD({ sizeBytes: 40 }), 40);
    for (const cookie of [s.cookie, c.cookie]) {
      const res = await download(cookie, doc.id);
      expect(res.statusCode).toBe(200);
      expect(res.json().url).toContain("fake-storage.test");
      expect(new Date(res.json().expiresAt).getTime()).toBeGreaterThan(Date.now());
    }

    // pending intent → 404
    const pending = await reqUpload(c.cookie, loadId, POD({ documentType: "OTHER", sizeBytes: 5 }));
    expect((await download(c.cookie, pending.json().document.id)).statusCode).toBe(404);

    // DB says confirmed but the object vanished → truthful failure, not a dead URL
    fake.clear();
    const res = await download(c.cookie, doc.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("DOCUMENT_OBJECT_MISSING");
  });

  it("a storage outage fails upload/confirm/download with 503 and never fabricates a confirmation", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);
    const doc = await uploadAndConfirm(c.cookie, loadId, POD({ sizeBytes: 50 }), 50);

    fake.simulateOutage();
    expect((await reqUpload(c.cookie, loadId, POD())).statusCode).toBe(503);
    const pending = await prisma.loadDocument.create({
      data: {
        loadId,
        docType: "POD",
        uploadedByUserId: c.userId,
        uploadedByCompanyId: c.companyId,
        storageKey: `loads/${loadId}/documents/00000000-0000-0000-0000-000000000009`,
        contentType: "application/pdf",
        sizeBytes: 10,
      },
    });
    expect((await confirm(c.cookie, pending.id)).statusCode).toBe(503);
    expect((await download(c.cookie, doc.id)).statusCode).toBe(503);
    // still exactly one confirmed doc; nothing corrupted
    expect(await prisma.loadDocument.count({ where: { loadId, confirmedAt: { not: null } } })).toBe(
      1,
    );
  });

  // ── rate limit ──────────────────────────────────────────────────

  it("the upload-request endpoint is rate-limited at 30/minute, independent of the global limit", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await assignedLoad(s, c);

    const codes: number[] = [];
    for (let i = 0; i < 32; i++) {
      codes.push((await reqUpload(c.cookie, loadId, POD({ sizeBytes: 10 + i }))).statusCode);
    }
    expect(codes.filter((x) => x === 201)).toHaveLength(30);
    expect(codes.filter((x) => x === 429).length).toBeGreaterThanOrEqual(1);
    // a non-upload document endpoint is NOT tripped by the same budget
    expect((await listDocs(c.cookie, loadId)).statusCode).toBe(200);
  });
});
