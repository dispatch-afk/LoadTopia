import type { PrismaClient } from "@loadtopia/db";
import { FakeStorageProvider } from "@loadtopia/providers";
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

type ShipperFx = Session & { a: string; b: string; c: string; z: string };

/**
 * M4 Phase 7 — Facility Scope Enforcement. Every scenario is built from the
 * SAME three-facility shipper company (A/B/C) named in the phase brief, so
 * the locked "origin OR destination" rule is exercised against genuinely
 * independent load combinations (AA/AB/BC/CC) rather than synthetic domain
 * fixtures. Every mutation/read path here is real product traffic through
 * `app.inject` — never a direct call into a service method.
 *
 * `Load.originLocationId !== destinationLocationId` is an enforced product
 * rule (createLoadSchema), so a literal "A -> A" load cannot exist. A fourth,
 * neutral facility Z (never in ANY dispatcher's scope in these tests) stands
 * in as the load's other endpoint wherever the brief's shorthand calls for a
 * load "only touching" one facility — e.g. "AA" is built as A -> Z. This is
 * semantically identical for the OR-rule under test: only ONE endpoint needs
 * to match a dispatcher's scope for the load to be visible, so A -> Z and a
 * hypothetical A -> A are indistinguishable to `isLoadInFacilityScope`.
 */
suite("Facility Scope Enforcement (M4 Phase 7, integration)", () => {
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

  /** The owner/admin shipper company, with Facility A/B/C already created. */
  async function shipperWithFacilities(name = "Acme Freight"): Promise<ShipperFx> {
    const s = await registerCompany(api, { type: "SHIPPER", companyName: name });
    const a = await createLocation(api, s.cookie, { name: "A", city: "Chicago", state: "IL" });
    const b = await createLocation(api, s.cookie, { name: "B", city: "Dallas", state: "TX" });
    const c = await createLocation(api, s.cookie, { name: "C", city: "Atlanta", state: "GA" });
    const z = await createLocation(api, s.cookie, { name: "Z", city: "Denver", state: "CO" });
    return { ...s, a, b, c, z };
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

  /** A non-primary SHIPPER-role member of `primary`'s company, optionally
   *  scoped at creation. `scopeLocationIds` omitted = left company-wide;
   *  an (possibly empty) array sets the scope to exactly those locations. */
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

  /** Post -> negotiated offer -> shipper (primary, always unrestricted) accepts.
   *  Auto-assigns atomically (Milestone 4 Phase 5) to CARRIER_ASSIGNED. */
  async function assignLoad(owner: Session, c: Session, loadId: string): Promise<void> {
    const post = await api.inject(
      authed(owner.cookie, { method: "POST", url: `/api/loads/${loadId}/post` }),
    );
    if (post.statusCode !== 200) throw new Error(`post ${post.statusCode}: ${post.body}`);
    const offer = await api.inject(
      authed(c.cookie, {
        method: "POST",
        url: `/api/marketplace/loads/${loadId}/offers`,
        payload: { amount: "1000.00", currency: "USD" },
      }),
    );
    if (offer.statusCode !== 201) throw new Error(`offer ${offer.statusCode}: ${offer.body}`);
    const accept = await api.inject(
      authed(owner.cookie, {
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

  /** Fully-covered, DELIVERED, approved-POD load — ready for /complete. Built
   *  with the unrestricted OWNER throughout so fixture setup itself is never
   *  blocked by the scope under test. */
  async function deliveredWithApprovedPod(
    owner: ShipperFx,
    c: Session,
    originId: string,
    destId: string,
  ): Promise<string> {
    const loadId = await loadBetween(owner, originId, destId);
    await assignLoad(owner, c, loadId);
    for (const verb of ["pickup", "in-transit", "deliver"] as const) {
      const r = await op(c.cookie, loadId, verb);
      if (r.statusCode !== 200) throw new Error(`${verb} ${r.statusCode}: ${r.body}`);
    }
    const docId = await uploadAndConfirmPod(c, loadId);
    const approve = await api.inject(
      authed(owner.cookie, { method: "POST", url: `/api/load-documents/${docId}/approve` }),
    );
    if (approve.statusCode !== 200) throw new Error(`approve ${approve.statusCode}: ${approve.body}`);
    return loadId;
  }

  const idsIn = (res: { json: () => { data: Array<{ id: string }> } }) =>
    res.json().data.map((r) => r.id);

  // ── §22/23 core visibility matrix — the locked OR rule ─────────────

  describe("core visibility matrix (origin OR destination)", () => {
    it("matches the phase brief's exact AA/AB/BC/CC x dispatcher-A/B/AB/unscoped table", async () => {
      const owner = await shipperWithFacilities();
      const dispA = await dispatcher(owner, "a", [owner.a]);
      const dispB = await dispatcher(owner, "b", [owner.b]);
      const dispAB = await dispatcher(owner, "ab", [owner.a, owner.b]);

      const loadAA = await loadBetween(owner, owner.a, owner.z);
      const loadAB = await loadBetween(owner, owner.a, owner.b);
      const loadBC = await loadBetween(owner, owner.b, owner.c);
      const loadCC = await loadBetween(owner, owner.c, owner.z);

      const listFor = async (cookie: string) => {
        const res = await api.inject(authed(cookie, { method: "GET", url: "/api/loads" }));
        expect(res.statusCode).toBe(200);
        return idsIn(res);
      };

      const visibleToA = await listFor(dispA.cookie);
      expect(visibleToA).toEqual(expect.arrayContaining([loadAA, loadAB]));
      expect(visibleToA).not.toEqual(expect.arrayContaining([loadBC, loadCC]));

      const visibleToB = await listFor(dispB.cookie);
      expect(visibleToB).toEqual(expect.arrayContaining([loadAB, loadBC]));
      expect(visibleToB).not.toEqual(expect.arrayContaining([loadAA, loadCC]));

      const visibleToAB = await listFor(dispAB.cookie);
      expect(visibleToAB).toEqual(expect.arrayContaining([loadAA, loadAB, loadBC]));
      expect(visibleToAB).not.toEqual(expect.arrayContaining([loadCC]));

      const visibleToOwner = await listFor(owner.cookie);
      expect(visibleToOwner).toEqual(
        expect.arrayContaining([loadAA, loadAB, loadBC, loadCC]),
      );
    });
  });

  // ── §17/23 load list enforcement ───────────────────────────────────

  describe("load list enforcement (GET /loads)", () => {
    it("pushes the restriction into the query — an out-of-scope load never appears, an unscoped membership sees everything", async () => {
      const owner = await shipperWithFacilities();
      const dispA = await dispatcher(owner, "list-a", [owner.a]);
      const unscoped = await dispatcher(owner, "list-unscoped");
      const loadAA = await loadBetween(owner, owner.a, owner.z);
      const loadCC = await loadBetween(owner, owner.c, owner.z);

      const asA = await api.inject(authed(dispA.cookie, { method: "GET", url: "/api/loads" }));
      expect(idsIn(asA)).toContain(loadAA);
      expect(idsIn(asA)).not.toContain(loadCC);

      const asUnscoped = await api.inject(
        authed(unscoped.cookie, { method: "GET", url: "/api/loads" }),
      );
      expect(idsIn(asUnscoped)).toEqual(expect.arrayContaining([loadAA, loadCC]));
    });

    it("status filtering and facility scope compose (AND, not OR)", async () => {
      const owner = await shipperWithFacilities();
      const dispA = await dispatcher(owner, "list-status", [owner.a]);
      const draftAA = await loadBetween(owner, owner.a, owner.z);
      const draftCC = await loadBetween(owner, owner.c, owner.z);

      const res = await api.inject(
        authed(dispA.cookie, { method: "GET", url: "/api/loads?status=DRAFT" }),
      );
      expect(res.statusCode).toBe(200);
      expect(idsIn(res)).toContain(draftAA);
      expect(idsIn(res)).not.toContain(draftCC);
    });
  });

  // ── §10/23 shipment list enforcement ───────────────────────────────

  describe("shipment list enforcement (GET /loads/shipments)", () => {
    it("restricts the shipper Shipments workspace exactly like the Loads list", async () => {
      const owner = await shipperWithFacilities();
      const c = await carrier();
      const dispA = await dispatcher(owner, "shipments-a", [owner.a]);

      const loadAA = await loadBetween(owner, owner.a, owner.z);
      const loadCC = await loadBetween(owner, owner.c, owner.z);
      await assignLoad(owner, c, loadAA);
      await assignLoad(owner, c, loadCC);

      const res = await api.inject(
        authed(dispA.cookie, { method: "GET", url: "/api/loads/shipments" }),
      );
      expect(res.statusCode).toBe(200);
      expect(idsIn(res)).toContain(loadAA);
      expect(idsIn(res)).not.toContain(loadCC);
    });
  });

  // ── §8/23 load detail enforcement ──────────────────────────────────

  describe("load detail enforcement (GET /loads/:id)", () => {
    it("in-scope is accessible; out-of-scope 404s; unscoped is unaffected", async () => {
      const owner = await shipperWithFacilities();
      const dispA = await dispatcher(owner, "detail-a", [owner.a]);
      const unscoped = await dispatcher(owner, "detail-unscoped");
      const loadAA = await loadBetween(owner, owner.a, owner.z);
      const loadCC = await loadBetween(owner, owner.c, owner.z);

      const inScope = await api.inject(
        authed(dispA.cookie, { method: "GET", url: `/api/loads/${loadAA}` }),
      );
      expect(inScope.statusCode).toBe(200);

      const outOfScope = await api.inject(
        authed(dispA.cookie, { method: "GET", url: `/api/loads/${loadCC}` }),
      );
      expect(outOfScope.statusCode).toBe(404);

      const unscopedRes = await api.inject(
        authed(unscoped.cookie, { method: "GET", url: `/api/loads/${loadCC}` }),
      );
      expect(unscopedRes.statusCode).toBe(200);
    });

    it("never returns a facility-specific error body — same 404 shape as cross-company IDOR", async () => {
      const owner = await shipperWithFacilities();
      const other = await shipperWithFacilities("Other Co");
      const dispA = await dispatcher(owner, "detail-idor", [owner.a]);
      const loadCC = await loadBetween(owner, owner.c, owner.z);
      const otherLoad = await loadBetween(other, other.a, other.z);

      const facilityDenied = await api.inject(
        authed(dispA.cookie, { method: "GET", url: `/api/loads/${loadCC}` }),
      );
      const crossCompanyDenied = await api.inject(
        authed(dispA.cookie, { method: "GET", url: `/api/loads/${otherLoad}` }),
      );
      expect(facilityDenied.statusCode).toBe(crossCompanyDenied.statusCode);
      expect(facilityDenied.json().code).toBe(crossCompanyDenied.json().code);
    });
  });

  // ── §9/24 load mutation enforcement ────────────────────────────────

  describe("load mutation enforcement", () => {
    it("PATCH edit: a scoped dispatcher cannot edit an out-of-scope DRAFT load", async () => {
      const owner = await shipperWithFacilities();
      const dispA = await dispatcher(owner, "mutate-patch", [owner.a]);
      const loadCC = await loadBetween(owner, owner.c, owner.z);

      const res = await api.inject(
        authed(dispA.cookie, {
          method: "PATCH",
          url: `/api/loads/${loadCC}`,
          payload: { commodity: "hijacked" },
        }),
      );
      expect(res.statusCode).toBe(404);

      const stillOriginal = await prisma.load.findUniqueOrThrow({ where: { id: loadCC } });
      expect(stillOriginal.commodity).toBe("goods");
    });

    it("post: a scoped dispatcher cannot post an out-of-scope DRAFT load to the marketplace", async () => {
      const owner = await shipperWithFacilities();
      const dispA = await dispatcher(owner, "mutate-post", [owner.a]);
      const loadCC = await loadBetween(owner, owner.c, owner.z);

      const res = await api.inject(
        authed(dispA.cookie, { method: "POST", url: `/api/loads/${loadCC}/post` }),
      );
      expect(res.statusCode).toBe(404);

      const stillDraft = await prisma.load.findUniqueOrThrow({ where: { id: loadCC } });
      expect(stillDraft.status).toBe("DRAFT");
    });

    it("cancel: a scoped dispatcher cannot cancel an out-of-scope load", async () => {
      const owner = await shipperWithFacilities();
      const dispA = await dispatcher(owner, "mutate-cancel", [owner.a]);
      const loadCC = await loadBetween(owner, owner.c, owner.z);

      const res = await api.inject(
        authed(dispA.cookie, { method: "POST", url: `/api/loads/${loadCC}/cancel` }),
      );
      expect(res.statusCode).toBe(404);

      const stillDraft = await prisma.load.findUniqueOrThrow({ where: { id: loadCC } });
      expect(stillDraft.status).toBe("DRAFT");
    });

    it("an in-scope mutation still succeeds for the same scoped dispatcher — this is a restriction, not a lockout", async () => {
      const owner = await shipperWithFacilities();
      const dispA = await dispatcher(owner, "mutate-positive", [owner.a]);
      const loadAA = await loadBetween(owner, owner.a, owner.z);

      const res = await api.inject(
        authed(dispA.cookie, {
          method: "PATCH",
          url: `/api/loads/${loadAA}`,
          payload: { commodity: "widgets" },
        }),
      );
      expect(res.statusCode).toBe(200);
      expect(res.json().commodity).toBe("widgets");
    });
  });

  // ── §9/24 later-stage operational mutation: complete ───────────────

  describe("complete enforcement (DELIVERED -> COMPLETED)", () => {
    it("a scoped dispatcher cannot complete an out-of-scope shipment even with an approved POD", async () => {
      const owner = await shipperWithFacilities();
      const c = await carrier();
      const dispA = await dispatcher(owner, "complete-a", [owner.a]);
      const loadCC = await deliveredWithApprovedPod(owner, c, owner.c, owner.z);

      const res = await api.inject(
        authed(dispA.cookie, { method: "POST", url: `/api/loads/${loadCC}/complete` }),
      );
      expect(res.statusCode).toBe(404);

      const stillDelivered = await prisma.load.findUniqueOrThrow({ where: { id: loadCC } });
      expect(stillDelivered.status).toBe("DELIVERED");
    });

    it("the same scoped dispatcher CAN complete an in-scope shipment with an approved POD", async () => {
      const owner = await shipperWithFacilities();
      const c = await carrier();
      const dispA = await dispatcher(owner, "complete-a-positive", [owner.a]);
      const loadAA = await deliveredWithApprovedPod(owner, c, owner.a, owner.z);

      const res = await api.inject(
        authed(dispA.cookie, { method: "POST", url: `/api/loads/${loadAA}/complete` }),
      );
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("COMPLETED");
    });
  });

  // ── §11/12/25 document + POD review enforcement ────────────────────

  describe("document and POD review enforcement", () => {
    it("a scoped shipper can list/read in-scope documents but not out-of-scope ones", async () => {
      const owner = await shipperWithFacilities();
      const c = await carrier();
      const dispA = await dispatcher(owner, "doc-list", [owner.a]);
      const loadAA = await loadBetween(owner, owner.a, owner.z);
      const loadCC = await loadBetween(owner, owner.c, owner.z);
      await assignLoad(owner, c, loadAA);
      await assignLoad(owner, c, loadCC);

      const inScope = await api.inject(
        authed(dispA.cookie, { method: "GET", url: `/api/loads/${loadAA}/documents` }),
      );
      expect(inScope.statusCode).toBe(200);

      const outOfScope = await api.inject(
        authed(dispA.cookie, { method: "GET", url: `/api/loads/${loadCC}/documents` }),
      );
      expect(outOfScope.statusCode).toBe(404);
    });

    it("a scoped shipper cannot upload, review, or remove through an out-of-scope load", async () => {
      const owner = await shipperWithFacilities();
      const c = await carrier();
      const dispA = await dispatcher(owner, "doc-mutate", [owner.a]);
      const loadCC = await loadBetween(owner, owner.c, owner.z);
      await assignLoad(owner, c, loadCC);
      for (const verb of ["pickup", "in-transit", "deliver"] as const) {
        await op(c.cookie, loadCC, verb);
      }

      const uploadDenied = await api.inject(
        authed(dispA.cookie, {
          method: "POST",
          url: `/api/loads/${loadCC}/documents`,
          payload: {
            documentType: "OTHER",
            originalFilename: "note.pdf",
            contentType: "application/pdf",
            sizeBytes: 128,
          },
        }),
      );
      expect(uploadDenied.statusCode).toBe(404);

      // A real POD to attempt review/remove against, uploaded by the carrier.
      const docId = await uploadAndConfirmPod(c, loadCC);

      const approveDenied = await api.inject(
        authed(dispA.cookie, { method: "POST", url: `/api/load-documents/${docId}/approve` }),
      );
      expect(approveDenied.statusCode).toBe(404);

      // Remove is uploader's-OWN-COMPANY-only (canManageOwnOperationalDocument) —
      // the carrier's POD above is never removable by ANY shipper-side actor, in
      // or out of scope, so it cannot isolate the facility-scope check. Use a
      // document the SHIPPER company itself uploaded (by the unrestricted owner)
      // instead — same company as dispA, so it reaches the facility-scope check.
      const shipperDoc = await api.inject(
        authed(owner.cookie, {
          method: "POST",
          url: `/api/loads/${loadCC}/documents`,
          payload: {
            documentType: "OTHER",
            originalFilename: "note.pdf",
            contentType: "application/pdf",
            sizeBytes: 64,
          },
        }),
      );
      if (shipperDoc.statusCode !== 201) {
        throw new Error(`shipperDoc ${shipperDoc.statusCode}: ${shipperDoc.body}`);
      }
      const shipperDocId = shipperDoc.json().document.id;
      fake.simulateUpload(
        `loads/${loadCC}/documents/${shipperDocId}`,
        new Uint8Array(64),
        "application/pdf",
      );
      const shipperConfirm = await api.inject(
        authed(owner.cookie, { method: "POST", url: `/api/load-documents/${shipperDocId}/confirm` }),
      );
      expect(shipperConfirm.statusCode).toBe(200);

      const removeDenied = await api.inject(
        authed(dispA.cookie, { method: "DELETE", url: `/api/load-documents/${shipperDocId}` }),
      );
      expect(removeDenied.statusCode).toBe(404);

      // Confirm the document truly untouched (not removed).
      const doc = await prisma.loadDocument.findUniqueOrThrow({ where: { id: shipperDocId } });
      expect(doc.removedAt).toBeNull();

      // And the unrestricted owner CAN remove its own company's document —
      // proving the denial above was facility scope, not a broken remove path.
      const removeAllowed = await api.inject(
        authed(owner.cookie, { method: "DELETE", url: `/api/load-documents/${shipperDocId}` }),
      );
      expect(removeAllowed.statusCode).toBe(200);
    });

    it("the assigned carrier's own document/POD workflow is completely unaffected by the SHIPPER's facility scope", async () => {
      const owner = await shipperWithFacilities();
      const c = await carrier();
      // Every shipper-side membership scoped to Facility A only — the load is B->B.
      await dispatcher(owner, "doc-carrier-unaffected", [owner.a]);
      const loadBB = await loadBetween(owner, owner.b, owner.z);
      await assignLoad(owner, c, loadBB);
      for (const verb of ["pickup", "in-transit", "deliver"] as const) {
        const r = await op(c.cookie, loadBB, verb);
        expect(r.statusCode).toBe(200);
      }
      // Carrier uploads/confirms/downloads/lists normally — carrier authorization
      // was never touched by Phase 7, and has no facility-scope concept at all.
      const docId = await uploadAndConfirmPod(c, loadBB);
      const list = await api.inject(
        authed(c.cookie, { method: "GET", url: `/api/loads/${loadBB}/documents` }),
      );
      expect(list.statusCode).toBe(200);
      const download = await api.inject(
        authed(c.cookie, { method: "GET", url: `/api/load-documents/${docId}/download` }),
      );
      expect(download.statusCode).toBe(200);

      // And the OWNER (unscoped) can still approve it — completion path intact.
      const approve = await api.inject(
        authed(owner.cookie, { method: "POST", url: `/api/load-documents/${docId}/approve` }),
      );
      expect(approve.statusCode).toBe(200);
    });
  });

  // ── §10/26 check-in enforcement ─────────────────────────────────────

  describe("check-in enforcement", () => {
    it("a scoped shipper sees in-scope check-ins but not out-of-scope ones", async () => {
      const owner = await shipperWithFacilities();
      const c = await carrier();
      const dispA = await dispatcher(owner, "checkin-a", [owner.a]);
      const loadAA = await loadBetween(owner, owner.a, owner.z);
      const loadCC = await loadBetween(owner, owner.c, owner.z);
      await assignLoad(owner, c, loadAA);
      await assignLoad(owner, c, loadCC);
      await api.inject(
        authed(c.cookie, {
          method: "POST",
          url: `/api/loads/${loadAA}/check-ins`,
          payload: { city: "Springfield", state: "IL" },
        }),
      );
      await api.inject(
        authed(c.cookie, {
          method: "POST",
          url: `/api/loads/${loadCC}/check-ins`,
          payload: { city: "Macon", state: "GA" },
        }),
      );

      const inScope = await api.inject(
        authed(dispA.cookie, { method: "GET", url: `/api/loads/${loadAA}/check-ins` }),
      );
      expect(inScope.statusCode).toBe(200);
      expect(inScope.json().data).toHaveLength(1);

      const outOfScope = await api.inject(
        authed(dispA.cookie, { method: "GET", url: `/api/loads/${loadCC}/check-ins` }),
      );
      expect(outOfScope.statusCode).toBe(404);
    });

    it("the assigned carrier's check-in recording is unaffected by shipper facility scope", async () => {
      const owner = await shipperWithFacilities();
      const c = await carrier();
      await dispatcher(owner, "checkin-carrier-unaffected", [owner.a]);
      const loadCC = await loadBetween(owner, owner.c, owner.z);
      await assignLoad(owner, c, loadCC);

      const res = await api.inject(
        authed(c.cookie, {
          method: "POST",
          url: `/api/loads/${loadCC}/check-ins`,
          payload: { city: "Macon", state: "GA" },
        }),
      );
      expect(res.statusCode).toBe(201);
    });
  });

  // ── §11/14/27 negotiation and commercial-artifact enforcement ──────

  describe("negotiation and Rate Confirmation enforcement", () => {
    it("a scoped shipper cannot list, reject, or read Rate Confirmation for an out-of-scope load's negotiation", async () => {
      const owner = await shipperWithFacilities();
      const c = await carrier();
      const dispA = await dispatcher(owner, "offers-a", [owner.a]);
      const loadCC = await loadBetween(owner, owner.c, owner.z);
      await api.inject(authed(owner.cookie, { method: "POST", url: `/api/loads/${loadCC}/post` }));
      const offer = await api.inject(
        authed(c.cookie, {
          method: "POST",
          url: `/api/marketplace/loads/${loadCC}/offers`,
          payload: { amount: "900.00", currency: "USD" },
        }),
      );
      expect(offer.statusCode).toBe(201);
      const threadId = offer.json().threadId;
      const roundId = offer.json().rounds[0].id;

      const listDenied = await api.inject(
        authed(dispA.cookie, { method: "GET", url: `/api/loads/${loadCC}/offers` }),
      );
      expect(listDenied.statusCode).toBe(404);

      const rejectDenied = await api.inject(
        authed(dispA.cookie, { method: "POST", url: `/api/offers/threads/${threadId}/reject` }),
      );
      expect(rejectDenied.statusCode).toBe(404);

      const counterDenied = await api.inject(
        authed(dispA.cookie, {
          method: "POST",
          url: `/api/offers/rounds/${roundId}/counter`,
          payload: { amount: "950.00", currency: "USD" },
        }),
      );
      expect(counterDenied.statusCode).toBe(404);

      // Thread genuinely untouched by the denied attempts.
      const thread = await prisma.offerThread.findUniqueOrThrow({ where: { id: threadId } });
      expect(thread.status).toBe("ACTIVE");
      expect(thread.roundCount).toBe(1);
    });

    it("a scoped shipper cannot read the Rate Confirmation for an out-of-scope AWARDED load", async () => {
      const owner = await shipperWithFacilities();
      const c = await carrier();
      const dispA = await dispatcher(owner, "rc-a", [owner.a]);
      const loadCC = await loadBetween(owner, owner.c, owner.z);
      await assignLoad(owner, c, loadCC);

      const denied = await api.inject(
        authed(dispA.cookie, { method: "GET", url: `/api/loads/${loadCC}/rate-confirmation` }),
      );
      expect(denied.statusCode).toBe(404);

      // The OWNER (unscoped) can still read it — RC access/immutability untouched.
      const allowed = await api.inject(
        authed(owner.cookie, { method: "GET", url: `/api/loads/${loadCC}/rate-confirmation` }),
      );
      expect(allowed.statusCode).toBe(200);
    });

    it("audience preview shares the identical assertCanModifyLoad + facility-scope boundary as PATCH — one representative check, not duplicated per audience endpoint", async () => {
      const owner = await shipperWithFacilities();
      const dispA = await dispatcher(owner, "audience-a", [owner.a]);
      const loadCC = await loadBetween(owner, owner.c, owner.z);

      const res = await api.inject(
        authed(dispA.cookie, {
          method: "POST",
          url: `/api/loads/${loadCC}/audience-preview`,
          payload: { strategy: "MARKETPLACE" },
        }),
      );
      expect(res.statusCode).toBe(404);
    });

    it("the CARRIER side of negotiation is entirely unaffected — createOffer/book/withdraw never consult shipper facility scope", async () => {
      const owner = await shipperWithFacilities();
      const c = await carrier();
      await dispatcher(owner, "offers-carrier-unaffected", [owner.a]);
      const loadCC = await loadBetween(owner, owner.c, owner.z, {
        commercialMode: "PUBLISH_RATE",
        postedRate: "1200.00",
      });
      await api.inject(authed(owner.cookie, { method: "POST", url: `/api/loads/${loadCC}/post` }));

      const book = await api.inject(
        authed(c.cookie, {
          method: "POST",
          url: `/api/marketplace/loads/${loadCC}/book`,
          payload: { confirmedRate: "1200.00" },
        }),
      );
      expect(book.statusCode).toBe(200);
    });
  });

  // ── §21/28 facility scope change reacts to current DB truth ────────

  describe("facility scope change is read fresh, never stale", () => {
    it("scoping to C, then clearing scope entirely, changes access immediately without any session refresh", async () => {
      const owner = await shipperWithFacilities();
      const dispA = await dispatcher(owner, "change-a", [owner.a]);
      const loadCC = await loadBetween(owner, owner.c, owner.z);

      const before = await api.inject(
        authed(dispA.cookie, { method: "GET", url: `/api/loads/${loadCC}` }),
      );
      expect(before.statusCode).toBe(404);

      const widen = await api.inject(
        authed(owner.cookie, {
          method: "PUT",
          url: `/api/memberships/${dispA.membershipId}/facility-scope`,
          payload: { locationIds: [owner.a, owner.c] },
        }),
      );
      expect(widen.statusCode).toBe(200);

      const afterWiden = await api.inject(
        authed(dispA.cookie, { method: "GET", url: `/api/loads/${loadCC}` }),
      );
      expect(afterWiden.statusCode).toBe(200);

      const clear = await api.inject(
        authed(owner.cookie, {
          method: "PUT",
          url: `/api/memberships/${dispA.membershipId}/facility-scope`,
          payload: { locationIds: [] },
        }),
      );
      expect(clear.statusCode).toBe(200);
      expect(clear.json().companyWide).toBe(true);

      // Now company-wide — a load in a facility NEVER in this dispatcher's
      // scope history (B) is also visible, proving this is real company-wide
      // access, not a cache of the widened A+C scope.
      const loadBB = await loadBetween(owner, owner.b, owner.z);
      const afterClear = await api.inject(
        authed(dispA.cookie, { method: "GET", url: `/api/loads/${loadBB}` }),
      );
      expect(afterClear.statusCode).toBe(200);
    });
  });

  // ── §21/29 multi-company session safety ─────────────────────────────

  describe("multi-company session safety", () => {
    it("scope set on one company's membership never applies after switching the active company", async () => {
      const companyX = await shipperWithFacilities("Company X");
      const companyY = await shipperWithFacilities("Company Y");

      // One throwaway user, added as a non-primary member of BOTH companies —
      // scoped to Facility A in X only; left company-wide in Y.
      const throwaway = await registerCompany(api, {
        type: "SHIPPER",
        companyName: "throwaway-multi",
      });
      const cookieInX = await addNonPrimaryMember(api, companyX.cookie, companyX.companyId, {
        email: throwaway.email,
        role: "SHIPPER",
      });
      const membershipInX = await prisma.membership
        .findFirstOrThrow({ where: { userId: throwaway.userId, companyId: companyX.companyId } })
        .then((m) => m.id);
      await api.inject(
        authed(companyX.cookie, {
          method: "PUT",
          url: `/api/memberships/${membershipInX}/facility-scope`,
          payload: { locationIds: [companyX.a] },
        }),
      );
      await addNonPrimaryMember(api, companyY.cookie, companyY.companyId, {
        email: throwaway.email,
        role: "SHIPPER",
      });

      const loadXA = await loadBetween(companyX, companyX.a, companyX.z);
      const loadXC = await loadBetween(companyX, companyX.c, companyX.z);
      const loadY = await loadBetween(companyY, companyY.b, companyY.z);

      // Acting on X: scoped to A — sees the A load, not the C load.
      const asX = await api.inject(
        authed(cookieInX, { method: "GET", url: `/api/loads/${loadXA}` }),
      );
      expect(asX.statusCode).toBe(200);
      const asXDenied = await api.inject(
        authed(cookieInX, { method: "GET", url: `/api/loads/${loadXC}` }),
      );
      expect(asXDenied.statusCode).toBe(404);

      // Switch active company to Y. `switch-company` reuses the SAME session
      // token — it flips `activeCompanyId` on the existing session row server
      // side rather than issuing a new cookie — so the cookie value itself is
      // unchanged; what changes is which membership it resolves to.
      const switchRes = await api.inject(
        authed(cookieInX, {
          method: "POST",
          url: "/api/auth/switch-company",
          payload: { companyId: companyY.companyId },
        }),
      );
      expect(switchRes.statusCode).toBe(200);
      expect(switchRes.json().activeCompanyId).toBe(companyY.companyId);
      const cookieInY = cookieInX;

      // Acting on Y: company-wide (unscoped there) — sees Y's load, proving
      // the leftover Facility-A scope from company X was never consulted.
      const asY = await api.inject(
        authed(cookieInY, { method: "GET", url: `/api/loads/${loadY}` }),
      );
      expect(asY.statusCode).toBe(200);

      // And, symmetrically, the X-only load remains invisible from Y — never
      // authorized "across" companies by this switch either.
      const asYCrossCompany = await api.inject(
        authed(cookieInY, { method: "GET", url: `/api/loads/${loadXA}` }),
      );
      expect(asYCrossCompany.statusCode).toBe(404);
    });
  });

  // ── §16 relationships remain company-wide, never facility-scoped ───

  describe("relationships remain company-wide (explicit non-scope)", () => {
    it("a facility-scoped dispatcher can still see and act on company connections regardless of scope", async () => {
      const owner = await shipperWithFacilities();
      const c = await carrier();
      const dispA = await dispatcher(owner, "relationship-a", [owner.a]);

      const req = await api.inject(
        authed(dispA.cookie, {
          method: "POST",
          url: `/api/companies/${c.companyId}/connections`,
        }),
      );
      expect(req.statusCode).toBe(201);
    });
  });

  // ── Pricing service — closes the test-coverage gap from the final
  //    security review. Same enforceLoadFacilityScope pattern as every
  //    other Phase 7 call site; this proves it end-to-end over real HTTP. ──

  describe("pricing enforcement (POST /pricing/estimate with loadId, GET /loads/:id/pricing)", () => {
    it("an in-scope shipper can estimate and list pricing for its own load", async () => {
      const owner = await shipperWithFacilities();
      const dispA = await dispatcher(owner, "pricing-in-scope", [owner.a]);
      const loadAB = await loadBetween(owner, owner.a, owner.b);

      const estimate = await api.inject(
        authed(dispA.cookie, {
          method: "POST",
          url: "/api/pricing/estimate",
          payload: { loadId: loadAB },
        }),
      );
      expect(estimate.statusCode).toBe(200);
      expect(estimate.json().snapshotId).not.toBeNull();

      const list = await api.inject(
        authed(dispA.cookie, { method: "GET", url: `/api/loads/${loadAB}/pricing` }),
      );
      expect(list.statusCode).toBe(200);
      expect(list.json().data.length).toBeGreaterThan(0);
    });

    it("an out-of-scope shipper is denied both pricing routes with the same anti-IDOR NOT_FOUND semantics", async () => {
      const owner = await shipperWithFacilities();
      const other = await shipperWithFacilities("Other Pricing Co");
      const dispA = await dispatcher(owner, "pricing-out-of-scope", [owner.a]);
      const loadCC = await loadBetween(owner, owner.c, owner.z);
      const otherLoad = await loadBetween(other, other.a, other.z);

      const estimateDenied = await api.inject(
        authed(dispA.cookie, {
          method: "POST",
          url: "/api/pricing/estimate",
          payload: { loadId: loadCC },
        }),
      );
      expect(estimateDenied.statusCode).toBe(404);
      expect(estimateDenied.json().error.code).toBe("NOT_FOUND");

      const listDenied = await api.inject(
        authed(dispA.cookie, { method: "GET", url: `/api/loads/${loadCC}/pricing` }),
      );
      expect(listDenied.statusCode).toBe(404);
      expect(listDenied.json().error.code).toBe("NOT_FOUND");

      // Same shape as the pre-existing cross-company IDOR denial — no
      // facility-specific error surface was introduced.
      const crossCompanyDenied = await api.inject(
        authed(dispA.cookie, {
          method: "POST",
          url: "/api/pricing/estimate",
          payload: { loadId: otherLoad },
        }),
      );
      expect(crossCompanyDenied.statusCode).toBe(estimateDenied.statusCode);
      expect(crossCompanyDenied.json().error.code).toBe(estimateDenied.json().error.code);

      // No snapshot was ever created for the denied load.
      const rows = await prisma.pricingSnapshot.findMany({ where: { loadId: loadCC } });
      expect(rows).toHaveLength(0);
    });

    it("an unscoped shipper membership retains full company-wide pricing access — same helper as GET /loads/:id/pricing, one route proves both", async () => {
      const owner = await shipperWithFacilities();
      const unscoped = await dispatcher(owner, "pricing-unscoped");
      const loadCC = await loadBetween(owner, owner.c, owner.z);

      const estimate = await api.inject(
        authed(unscoped.cookie, {
          method: "POST",
          url: "/api/pricing/estimate",
          payload: { loadId: loadCC },
        }),
      );
      expect(estimate.statusCode).toBe(200);
    });

    it("carrier ad-hoc lane estimates (no loadId) remain entirely unaffected — the facility branch is never reached", async () => {
      const c = await carrier();
      const res = await api.inject(
        authed(c.cookie, {
          method: "POST",
          url: "/api/pricing/estimate",
          payload: { originState: "IL", destinationState: "TX", equipmentType: "DRY_VAN" },
        }),
      );
      expect(res.statusCode).toBe(200);
      // Ad-hoc estimates never persist a snapshot (no loadId to attach one to).
      expect(res.json().snapshotId).toBeNull();
    });

    it("carrier loadId-scoped pricing remains denied exactly as before Phase 7 — never widened", async () => {
      const owner = await shipperWithFacilities();
      const c = await carrier();
      const loadAB = await loadBetween(owner, owner.a, owner.b);

      const res = await api.inject(
        authed(c.cookie, {
          method: "POST",
          url: "/api/pricing/estimate",
          payload: { loadId: loadAB },
        }),
      );
      // assertCanModifyLoad (shipper-only + admin) rejects the carrier before
      // facility scope is ever reached — this is pre-existing, unchanged.
      expect(res.statusCode).toBe(404);
    });

    it("the mock pricing invariant is preserved: provider stays mock, no calculation changed", async () => {
      const owner = await shipperWithFacilities();
      const loadAB = await loadBetween(owner, owner.a, owner.b);

      const estimate = await api.inject(
        authed(owner.cookie, {
          method: "POST",
          url: "/api/pricing/estimate",
          payload: { loadId: loadAB },
        }),
      );
      expect(estimate.statusCode).toBe(200);
      const body = estimate.json();
      expect(body.isMock).toBe(true);
      expect(body.provider).toBe("mock");
      expect(body.currency).toBe("USD");
      expect(typeof body.lowRate).toBe("string");
      expect(typeof body.midRate).toBe("string");
      expect(typeof body.highRate).toBe("string");

      const list = await api.inject(
        authed(owner.cookie, { method: "GET", url: `/api/loads/${loadAB}/pricing` }),
      );
      const snapshot = list.json().data[0];
      expect(snapshot.isMock).toBe(true);
      expect(snapshot.provider).toBe("mock");
      expect(snapshot.currency).toBe("USD");
    });
  });

  // ── Release engine — closes the second test-coverage gap. releaseNow,
  //    rescheduleRelease, and cancelScheduledRelease all call the SAME
  //    loadAndStrategyForActor(tx, actor, loadId) as their first action
  //    inside their own transaction (verified by reading release-engine.ts:
  //    each of the three exported functions' transaction body opens with
  //    `await loadAndStrategyForActor(tx, actor, loadId)` before any read or
  //    write of release/strategy state). One direct test against
  //    `release-now` therefore proves the shared boundary for all three —
  //    reschedule/cancel-release are not independently re-tested here. ──

  describe("release-engine enforcement (loadAndStrategyForActor, shared by release-now/reschedule/cancel-release)", () => {
    /** NETWORK_FIRST requires at least one ACCEPTED connection to a carrier
     *  (resolveEligibleNetworkCarriers) — connect a fresh eligible carrier to
     *  the shipper first, so posting doesn't 409 on the pre-existing, unrelated
     *  "Empty Audience" rule. */
    async function connectedCarrier(s: Session): Promise<void> {
      const c = await carrier();
      const req = await api.inject(
        authed(s.cookie, { method: "POST", url: `/api/companies/${c.companyId}/connections` }),
      );
      if (req.statusCode !== 201) throw new Error(`connect request ${req.statusCode}: ${req.body}`);
      const accept = await api.inject(
        authed(c.cookie, { method: "POST", url: `/api/connections/${req.json().id}/accept` }),
      );
      if (accept.statusCode !== 200) throw new Error(`connect accept ${accept.statusCode}: ${accept.body}`);
    }

    /** A POSTED load with a NETWORK_FIRST strategy and no scheduled releases
     *  — starts at the NETWORK stage, so "release now -> MARKETPLACE" is a
     *  real, forward, deterministic hop with nothing to race against. */
    async function postedNetworkFirst(s: ShipperFx, originId: string, destId: string) {
      await connectedCarrier(s);
      const loadId = await loadBetween(s, originId, destId);
      const post = await api.inject(
        authed(s.cookie, {
          method: "POST",
          url: `/api/loads/${loadId}/post`,
          payload: { strategy: "NETWORK_FIRST", releases: [] },
        }),
      );
      if (post.statusCode !== 200) throw new Error(`post ${post.statusCode}: ${post.body}`);
      return loadId;
    }

    it("an in-scope shipper can Release to Marketplace Now", async () => {
      const owner = await shipperWithFacilities();
      const dispA = await dispatcher(owner, "release-in-scope", [owner.a]);
      const loadAB = await postedNetworkFirst(owner, owner.a, owner.b);

      const res = await api.inject(
        authed(dispA.cookie, {
          method: "POST",
          url: `/api/loads/${loadAB}/release-now`,
          payload: { target: "MARKETPLACE" },
        }),
      );
      expect(res.statusCode).toBe(200);

      const strategy = await prisma.loadAudienceStrategyRecord.findUniqueOrThrow({
        where: { loadId: loadAB },
      });
      expect(strategy.currentStage).toBe("MARKETPLACE");
    });

    it("an out-of-scope shipper cannot Release to Marketplace Now — audience/release/event state stays untouched", async () => {
      const owner = await shipperWithFacilities();
      const dispA = await dispatcher(owner, "release-out-of-scope", [owner.a]);
      const loadCC = await postedNetworkFirst(owner, owner.c, owner.z);

      const before = await prisma.loadAudienceStrategyRecord.findUniqueOrThrow({
        where: { loadId: loadCC },
      });
      expect(before.currentStage).toBe("NETWORK");
      const eventsBefore = await prisma.loadEvent.count({ where: { loadId: loadCC } });

      const res = await api.inject(
        authed(dispA.cookie, {
          method: "POST",
          url: `/api/loads/${loadCC}/release-now`,
          payload: { target: "MARKETPLACE" },
        }),
      );
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("NOT_FOUND");

      // No stage advance, no release row, no new event — nothing mutated by
      // the denied attempt (the check runs before any write, under the lock).
      const after = await prisma.loadAudienceStrategyRecord.findUniqueOrThrow({
        where: { loadId: loadCC },
      });
      expect(after.currentStage).toBe("NETWORK");
      const eventsAfter = await prisma.loadEvent.count({ where: { loadId: loadCC } });
      expect(eventsAfter).toBe(eventsBefore);

      // And the load never actually reached the marketplace board.
      const cCarrier = await carrier("Board Check Carrier");
      const board = await api.inject(
        authed(cCarrier.cookie, { method: "GET", url: "/api/marketplace/loads" }),
      );
      expect(board.json().data.map((l: { id: string }) => l.id)).not.toContain(loadCC);
    });

    it("the unrestricted owner can still release the same out-of-scope-for-dispA load — proving the denial above was facility scope, not a broken route", async () => {
      const owner = await shipperWithFacilities();
      const loadCC = await postedNetworkFirst(owner, owner.c, owner.z);

      const res = await api.inject(
        authed(owner.cookie, {
          method: "POST",
          url: `/api/loads/${loadCC}/release-now`,
          payload: { target: "MARKETPLACE" },
        }),
      );
      expect(res.statusCode).toBe(200);
    });
  });
});
