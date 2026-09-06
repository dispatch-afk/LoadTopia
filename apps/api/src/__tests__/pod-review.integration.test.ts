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

suite("POD review + replacement + removal (integration)", () => {
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

  /** Upload + confirm a POD as the carrier. Returns the document id. */
  async function uploadPod(
    c: Session,
    loadId: string,
    over: Record<string, unknown> = {},
  ): Promise<string> {
    const size = (over.sizeBytes as number) ?? 256;
    const r = await api.inject(
      authed(c.cookie, {
        method: "POST",
        url: `/api/loads/${loadId}/documents`,
        payload: {
          documentType: "POD",
          originalFilename: "pod.pdf",
          contentType: "application/pdf",
          sizeBytes: size,
          ...over,
        },
      }),
    );
    if (r.statusCode !== 201) throw new Error(`uploadPod ${r.statusCode}: ${r.body}`);
    const id = r.json().document.id;
    fake.simulateUpload(`loads/${loadId}/documents/${id}`, new Uint8Array(size), "application/pdf");
    const c2 = await api.inject(
      authed(c.cookie, { method: "POST", url: `/api/load-documents/${id}/confirm` }),
    );
    if (c2.statusCode !== 200) throw new Error(`confirm ${c2.statusCode}: ${c2.body}`);
    return id;
  }

  const approve = (cookie: string, id: string) =>
    api.inject(authed(cookie, { method: "POST", url: `/api/load-documents/${id}/approve` }));
  const reject = (cookie: string, id: string, reason?: string) =>
    api.inject(
      authed(cookie, {
        method: "POST",
        url: `/api/load-documents/${id}/reject`,
        payload: reason === undefined ? {} : { reason },
      }),
    );
  const removeDoc = (cookie: string, id: string) =>
    api.inject(authed(cookie, { method: "DELETE", url: `/api/load-documents/${id}` }));

  // ── review authorization ───────────────────────────────────────

  it("the owning shipper approves a PENDING_REVIEW POD; the carrier and other shippers cannot", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await deliveredLoad(s, c);
    const podId = await uploadPod(c, loadId);

    expect((await approve(c.cookie, podId)).statusCode).toBe(403); // uploader cannot review
    const other = await shipper("Rival Foods");
    expect((await approve(other.cookie, podId)).statusCode).toBe(404); // cross-company → IDOR-safe

    const res = await approve(s.cookie, podId);
    expect(res.statusCode).toBe(200);
    expect(res.json().reviewStatus).toBe("APPROVED");

    const review = await prisma.documentReview.findUniqueOrThrow({ where: { documentId: podId } });
    expect(review.decision).toBe("APPROVED");
    expect(review.reviewerUserId).toBe(s.userId);
    expect(review.reviewerCompanyId).toBe(s.companyId);

    const events = await prisma.loadEvent.findMany({
      where: { loadId, type: "DOCUMENT_REVIEWED" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.actorUserId).toBe(s.userId);
    expect(events[0]!.actorCompanyId).toBe(s.companyId);
  });

  it("reject requires a reason and stores it immutably", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await deliveredLoad(s, c);
    const podId = await uploadPod(c, loadId);

    expect((await reject(s.cookie, podId)).statusCode).toBe(400); // no reason
    expect((await reject(s.cookie, podId, "   ")).statusCode).toBe(400);

    const res = await reject(s.cookie, podId, "  signature illegible  ");
    expect(res.statusCode).toBe(200);
    expect(res.json().reviewStatus).toBe("REJECTED");
    expect(res.json().reviewReason).toBe("signature illegible");

    const review = await prisma.documentReview.findUniqueOrThrow({ where: { documentId: podId } });
    expect(review.reason).toBe("signature illegible");
  });

  it("only a confirmed POD can be reviewed — not BOL, not OTHER, not an unconfirmed POD", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await deliveredLoad(s, c);

    // BOL confirmed
    const bolReq = await api.inject(
      authed(c.cookie, {
        method: "POST",
        url: `/api/loads/${loadId}/documents`,
        payload: {
          documentType: "BOL",
          originalFilename: "bol.pdf",
          contentType: "application/pdf",
          sizeBytes: 10,
        },
      }),
    );
    const bolId = bolReq.json().document.id;
    fake.simulateUpload(
      `loads/${loadId}/documents/${bolId}`,
      new Uint8Array(10),
      "application/pdf",
    );
    await api.inject(
      authed(c.cookie, { method: "POST", url: `/api/load-documents/${bolId}/confirm` }),
    );
    expect((await approve(s.cookie, bolId)).statusCode).toBe(409);

    // unconfirmed POD
    const podReq = await api.inject(
      authed(c.cookie, {
        method: "POST",
        url: `/api/loads/${loadId}/documents`,
        payload: {
          documentType: "POD",
          originalFilename: "p.pdf",
          contentType: "application/pdf",
          sizeBytes: 10,
        },
      }),
    );
    expect((await approve(s.cookie, podReq.json().document.id)).statusCode).toBe(409);
  });

  // ── terminal state machine ─────────────────────────────────────

  it("APPROVED and REJECTED are terminal for that POD — no second review, ever", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await deliveredLoad(s, c);

    const approved = await uploadPod(c, loadId);
    await approve(s.cookie, approved);
    expect((await approve(s.cookie, approved)).statusCode).toBe(409);
    expect((await reject(s.cookie, approved, "changed my mind")).statusCode).toBe(409);

    const rejected = await uploadPod(c, loadId);
    await reject(s.cookie, rejected, "bad scan");
    expect((await reject(s.cookie, rejected, "still bad")).statusCode).toBe(409);
    expect((await approve(s.cookie, rejected)).statusCode).toBe(409);

    for (const id of [approved, rejected]) {
      expect(await prisma.documentReview.count({ where: { documentId: id } })).toBe(1);
      expect(
        await prisma.loadEvent.count({
          where: { type: "DOCUMENT_REVIEWED", data: { path: ["documentId"], equals: id } },
        }),
      ).toBe(1);
    }
  });

  it("a concurrent approve + reject on the same POD → exactly one terminal decision", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await deliveredLoad(s, c);
    const podId = await uploadPod(c, loadId);

    const [a, b] = await Promise.all([approve(s.cookie, podId), reject(s.cookie, podId, "blur")]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);

    expect(await prisma.documentReview.count({ where: { documentId: podId } })).toBe(1);
    expect(await prisma.loadEvent.count({ where: { loadId, type: "DOCUMENT_REVIEWED" } })).toBe(1);
    const row = await prisma.loadDocument.findUniqueOrThrow({ where: { id: podId } });
    expect(["APPROVED", "REJECTED"]).toContain(row.reviewStatus);
  });

  it("a terminal document_reviews row cannot be UPDATEd or DELETEd (append-only trigger)", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await deliveredLoad(s, c);
    const podId = await uploadPod(c, loadId);
    await reject(s.cookie, podId, "smudge");
    const review = await prisma.documentReview.findUniqueOrThrow({ where: { documentId: podId } });

    await expect(
      prisma.documentReview.update({ where: { id: review.id }, data: { decision: "APPROVED" } }),
    ).rejects.toThrow();
    await expect(prisma.documentReview.delete({ where: { id: review.id } })).rejects.toThrow();
  });

  // ── replacement POD ───────────────────────────────────────────

  it("a REJECTED POD may be replaced by a new POD; the original stays immutable", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await deliveredLoad(s, c);
    const original = await uploadPod(c, loadId);
    await reject(s.cookie, original, "wrong consignee");
    const originalRow = await prisma.loadDocument.findUniqueOrThrow({ where: { id: original } });

    const replacement = await uploadPod(c, loadId, { replacedDocumentId: original });
    expect(replacement).not.toBe(original);
    const replRow = await prisma.loadDocument.findUniqueOrThrow({ where: { id: replacement } });
    expect(replRow.replacesDocumentId).toBe(original);
    expect(replRow.reviewStatus).toBe("PENDING_REVIEW");

    // original untouched
    expect(await prisma.loadDocument.findUniqueOrThrow({ where: { id: original } })).toEqual(
      originalRow,
    );
    // rejected original still in the list forever
    const list = await api.inject(
      authed(s.cookie, { method: "GET", url: `/api/loads/${loadId}/documents` }),
    );
    expect(
      list
        .json()
        .data.map((d: { id: string }) => d.id)
        .sort(),
    ).toEqual([original, replacement].sort());

    // approving the replacement works
    expect((await approve(s.cookie, replacement)).statusCode).toBe(200);
  });

  it("rejects a replacement reference that is not a REJECTED POD on this load", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await deliveredLoad(s, c);
    const s2 = await shipper("Two");
    const c2 = await carrier("Two Co");
    const otherLoad = await deliveredLoad(s2, c2);

    const pending = await uploadPod(c, loadId); // PENDING_REVIEW
    const approved = await uploadPod(c, loadId);
    await approve(s.cookie, approved);
    const crossLoad = await uploadPod(c2, otherLoad);
    await reject(s2.cookie, crossLoad, "x");
    const bolReq = await api.inject(
      authed(c.cookie, {
        method: "POST",
        url: `/api/loads/${loadId}/documents`,
        payload: {
          documentType: "BOL",
          originalFilename: "b.pdf",
          contentType: "application/pdf",
          sizeBytes: 5,
        },
      }),
    );
    const bolId = bolReq.json().document.id;
    fake.simulateUpload(`loads/${loadId}/documents/${bolId}`, new Uint8Array(5), "application/pdf");
    await api.inject(
      authed(c.cookie, { method: "POST", url: `/api/load-documents/${bolId}/confirm` }),
    );

    const badTargets = [
      pending,
      approved,
      crossLoad,
      bolId,
      "00000000-0000-0000-0000-000000000000",
    ];
    for (const target of badTargets) {
      const res = await api.inject(
        authed(c.cookie, {
          method: "POST",
          url: `/api/loads/${loadId}/documents`,
          payload: {
            documentType: "POD",
            originalFilename: "r.pdf",
            contentType: "application/pdf",
            sizeBytes: 9,
            replacedDocumentId: target,
          },
        }),
      );
      expect(res.statusCode, target).toBe(400);
      expect(res.json().error.code).toBe("INVALID_REPLACEMENT_TARGET");
    }
  });

  // ── removal / retention ───────────────────────────────────────

  it("a confirmed unreviewed BOL / PENDING_REVIEW POD can be soft-removed by its uploader only", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await deliveredLoad(s, c);
    const podId = await uploadPod(c, loadId); // PENDING_REVIEW

    // the shipper did not upload it → cannot remove it
    expect((await removeDoc(s.cookie, podId)).statusCode).toBe(403);

    const res = await removeDoc(c.cookie, podId);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("REMOVED");
    expect(res.json().removedAt).toBeTruthy();

    // soft only — row still exists, object untouched
    const row = await prisma.loadDocument.findUniqueOrThrow({ where: { id: podId } });
    expect(row.removedAt).not.toBeNull();
    expect(fake.storedKeys()).toContain(`loads/${loadId}/documents/${podId}`);
    // removed → gone from the list, not downloadable
    const list = await api.inject(
      authed(s.cookie, { method: "GET", url: `/api/loads/${loadId}/documents` }),
    );
    expect(list.json().data).toHaveLength(0);
    expect(
      (
        await api.inject(
          authed(c.cookie, { method: "GET", url: `/api/load-documents/${podId}/download` }),
        )
      ).statusCode,
    ).toBe(404);
    // a DOCUMENT_REMOVED event was written
    expect(await prisma.loadEvent.count({ where: { loadId, type: "DOCUMENT_REMOVED" } })).toBe(1);
  });

  it("an APPROVED or REJECTED POD can never be removed — by anyone", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await deliveredLoad(s, c);

    const approved = await uploadPod(c, loadId);
    await approve(s.cookie, approved);
    const rejected = await uploadPod(c, loadId);
    await reject(s.cookie, rejected, "bad");

    for (const id of [approved, rejected]) {
      for (const who of [c, s]) {
        const res = await removeDoc(who.cookie, id);
        expect([403]).toContain(res.statusCode);
      }
      const row = await prisma.loadDocument.findUniqueOrThrow({ where: { id } });
      expect(row.removedAt).toBeNull();
    }
  });

  it("no operational document row is ever physically deleted", async () => {
    const s = await shipper();
    const c = await carrier();
    const loadId = await deliveredLoad(s, c);
    const podId = await uploadPod(c, loadId);
    await removeDoc(c.cookie, podId);
    // still there, just soft-removed
    expect(await prisma.loadDocument.count({ where: { id: podId } })).toBe(1);
  });
});
