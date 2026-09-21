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

/**
 * M4 Phase 10 — Coverage Workspace (shipper Loads `group` filter) and
 * Find Freight (marketplace origin/destination/equipment/pickup filters).
 */
suite("Phase 10 — coverage grouping & marketplace filters (integration)", () => {
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

  type ShipperFx = Session & { origin: string; dest: string; a: string; z: string };

  async function shipper(name = "Acme Freight"): Promise<ShipperFx> {
    const s = await registerCompany(api, { type: "SHIPPER", companyName: name });
    const origin = await createLocation(api, s.cookie, { name: "O", city: "Chicago", state: "IL" });
    const dest = await createLocation(api, s.cookie, { name: "D", city: "Dallas", state: "TX" });
    const a = await createLocation(api, s.cookie, { name: "A", city: "Denver", state: "CO" });
    const z = await createLocation(api, s.cookie, { name: "Z", city: "Reno", state: "NV" });
    return { ...s, origin, dest, a, z };
  }

  async function carrier(
    name = "Sunrise Carriers",
    opts: { equipmentTypes?: string[]; serviceAreaStates?: string[] } = {},
  ): Promise<Session> {
    const s = await registerCompany(api, { type: "CARRIER", companyName: name });
    await api.inject(
      authed(s.cookie, {
        method: "PUT",
        url: "/api/carrier/profile",
        payload: {
          legalName: `${name} LLC`,
          equipmentTypes: opts.equipmentTypes ?? [],
          serviceAreaStates: opts.serviceAreaStates ?? [],
        },
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

  async function postLoad(s: Session, loadId: string): Promise<void> {
    const post = await api.inject(authed(s.cookie, { method: "POST", url: `/api/loads/${loadId}/post` }));
    if (post.statusCode !== 200) throw new Error(`post ${post.statusCode}: ${post.body}`);
  }

  async function assignLoad(s: Session, c: Session, loadId: string): Promise<void> {
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
      authed(s.cookie, { method: "POST", url: `/api/offers/rounds/${offer.json().rounds[0].id}/accept` }),
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

  async function completeLoad(s: Session, c: Session, loadId: string): Promise<void> {
    for (const verb of ["pickup", "in-transit", "deliver"] as const) {
      const r = await op(c.cookie, loadId, verb);
      if (r.statusCode !== 200) throw new Error(`${verb} ${r.statusCode}: ${r.body}`);
    }
    const docId = await uploadAndConfirmPod(c, loadId);
    const approve = await api.inject(
      authed(s.cookie, { method: "POST", url: `/api/load-documents/${docId}/approve` }),
    );
    if (approve.statusCode !== 200) throw new Error(`approve ${approve.statusCode}: ${approve.body}`);
    const complete = await api.inject(
      authed(s.cookie, { method: "POST", url: `/api/loads/${loadId}/complete` }),
    );
    if (complete.statusCode !== 200) throw new Error(`complete ${complete.statusCode}: ${complete.body}`);
  }

  async function listLoads(cookie: string, query: Record<string, string>) {
    const qs = new URLSearchParams(query).toString();
    const res = await api.inject(authed(cookie, { method: "GET", url: `/api/loads${qs ? `?${qs}` : ""}` }));
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  async function listMarketplace(cookie: string, query: Record<string, string>) {
    const qs = new URLSearchParams(query).toString();
    const res = await api.inject(
      authed(cookie, { method: "GET", url: `/api/marketplace/loads${qs ? `?${qs}` : ""}` }),
    );
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  // ═══════════════════════════════════════════════════════════════════
  // Shipper coverage grouping
  // ═══════════════════════════════════════════════════════════════════

  describe("GET /loads coverage grouping", () => {
    it("1. group=DRAFT returns only DRAFT loads", async () => {
      const s = await shipper();
      const draft = await loadBetween(s, s.origin, s.dest);
      const posted = await loadBetween(s, s.origin, s.dest);
      await postLoad(s, posted);

      const body = await listLoads(s.cookie, { group: "DRAFT" });
      expect(body.data.map((l: { id: string }) => l.id)).toEqual([draft]);
      expect(body.total).toBe(1);
    });

    it("2. group=NEEDS_COVERAGE returns POSTED and OFFER_RECEIVED, excludes DRAFT/AWARDED", async () => {
      const s = await shipper();
      const c = await carrier();
      await loadBetween(s, s.origin, s.dest); // DRAFT
      const posted = await loadBetween(s, s.origin, s.dest);
      await postLoad(s, posted);
      const offered = await loadBetween(s, s.origin, s.dest);
      await postLoad(s, offered);
      await api.inject(
        authed(c.cookie, {
          method: "POST",
          url: `/api/marketplace/loads/${offered}/offers`,
          payload: { amount: "500.00", currency: "USD" },
        }),
      );
      const awarded = await loadBetween(s, s.origin, s.dest);
      await assignLoad(s, c, awarded);

      const body = await listLoads(s.cookie, { group: "NEEDS_COVERAGE" });
      const ids = body.data.map((l: { id: string }) => l.id);
      expect(ids.sort()).toEqual([posted, offered].sort());
      expect(body.total).toBe(2);
    });

    it("3. group=COVERED returns AWARDED..DELIVERED, excludes COMPLETED", async () => {
      const s = await shipper();
      const c = await carrier();
      const awarded = await loadBetween(s, s.origin, s.dest);
      await assignLoad(s, c, awarded);
      const completed = await loadBetween(s, s.origin, s.dest);
      await assignLoad(s, c, completed);
      await completeLoad(s, c, completed);

      const body = await listLoads(s.cookie, { group: "COVERED" });
      const ids = body.data.map((l: { id: string }) => l.id);
      expect(ids).toContain(awarded);
      expect(ids).not.toContain(completed);
    });

    it("4. no group returns All (every status)", async () => {
      const s = await shipper();
      await loadBetween(s, s.origin, s.dest);
      const posted = await loadBetween(s, s.origin, s.dest);
      await postLoad(s, posted);

      const body = await listLoads(s.cookie, {});
      expect(body.total).toBe(2);
    });

    it("5. group + compatible status narrows to exactly that status", async () => {
      const s = await shipper();
      const c = await carrier();
      const posted = await loadBetween(s, s.origin, s.dest);
      await postLoad(s, posted);
      const offered = await loadBetween(s, s.origin, s.dest);
      await postLoad(s, offered);
      await api.inject(
        authed(c.cookie, {
          method: "POST",
          url: `/api/marketplace/loads/${offered}/offers`,
          payload: { amount: "500.00", currency: "USD" },
        }),
      );

      const body = await listLoads(s.cookie, { group: "NEEDS_COVERAGE", status: "POSTED" });
      expect(body.data.map((l: { id: string }) => l.id)).toEqual([posted]);
    });

    it("6. group + incompatible status yields zero rows", async () => {
      const s = await shipper();
      const posted = await loadBetween(s, s.origin, s.dest);
      await postLoad(s, posted);

      const body = await listLoads(s.cookie, { group: "COVERED", status: "POSTED" });
      expect(body.data).toEqual([]);
      expect(body.total).toBe(0);
    });

    it("7. pagination total follows the group predicate exactly", async () => {
      const s = await shipper();
      for (let i = 0; i < 3; i++) {
        const id = await loadBetween(s, s.origin, s.dest);
        await postLoad(s, id);
      }
      await loadBetween(s, s.origin, s.dest); // one DRAFT, not in NEEDS_COVERAGE

      const body = await listLoads(s.cookie, { group: "NEEDS_COVERAGE", pageSize: "2" });
      expect(body.total).toBe(3);
      expect(body.totalPages).toBe(2);
      expect(body.data).toHaveLength(2);
    });

    it("8/9/10. a facility-scoped dispatcher sees only in-scope rows in every group; out-of-scope freight leaks nothing", async () => {
      const s = await shipper();
      const c = await carrier();
      const dispA = await dispatcher(s, "phase10-a", [s.a]);

      const inScopePosted = await loadBetween(s, s.a, s.dest);
      await postLoad(s, inScopePosted);
      const inScopeAwarded = await loadBetween(s, s.a, s.dest);
      await assignLoad(s, c, inScopeAwarded);

      const outOfScopePosted = await loadBetween(s, s.z, s.dest);
      await postLoad(s, outOfScopePosted);
      const outOfScopeAwarded = await loadBetween(s, s.z, s.dest);
      await assignLoad(s, c, outOfScopeAwarded);

      const needsCoverage = await listLoads(dispA.cookie, { group: "NEEDS_COVERAGE" });
      expect(needsCoverage.data.map((l: { id: string }) => l.id)).toEqual([inScopePosted]);
      expect(needsCoverage.total).toBe(1);

      const covered = await listLoads(dispA.cookie, { group: "COVERED" });
      expect(covered.data.map((l: { id: string }) => l.id)).toEqual([inScopeAwarded]);
      expect(covered.total).toBe(1);

      const all = await listLoads(dispA.cookie, {});
      expect(all.total).toBe(2);

      // No trace of the out-of-scope loads anywhere in any response.
      expect(JSON.stringify(needsCoverage)).not.toContain(outOfScopePosted);
      expect(JSON.stringify(covered)).not.toContain(outOfScopeAwarded);
      expect(JSON.stringify(all)).not.toContain(outOfScopePosted);
      expect(JSON.stringify(all)).not.toContain(outOfScopeAwarded);
    });

    it("11. an unscoped membership retains full company-wide grouped results", async () => {
      const s = await shipper();
      const c = await carrier();
      await dispatcher(s, "phase10-unscoped");
      const posted = await loadBetween(s, s.a, s.dest);
      await postLoad(s, posted);
      const awarded = await loadBetween(s, s.z, s.dest);
      await assignLoad(s, c, awarded);

      const all = await listLoads(s.cookie, {});
      expect(all.total).toBe(2);
    });

    it("12. commercialNextAction is serialized correctly per status", async () => {
      const s = await shipper();
      const c = await carrier();
      const draft = await loadBetween(s, s.origin, s.dest);
      const posted = await loadBetween(s, s.origin, s.dest);
      await postLoad(s, posted);
      const awarded = await loadBetween(s, s.origin, s.dest);
      await assignLoad(s, c, awarded);

      const body = await listLoads(s.cookie, {});
      const byId = new Map(body.data.map((l: { id: string; commercialNextAction: string }) => [l.id, l]));
      expect((byId.get(draft) as { commercialNextAction: string }).commercialNextAction).toBe(
        "Finish Draft",
      );
      expect((byId.get(posted) as { commercialNextAction: string }).commercialNextAction).toBe(
        "Awaiting Coverage",
      );
      expect((byId.get(awarded) as { commercialNextAction: string }).commercialNextAction).toBe(
        "Covered — View Shipment",
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Carrier Find Freight filters
  // ═══════════════════════════════════════════════════════════════════

  describe("GET /marketplace/loads filters", () => {
    it("originState narrows correctly", async () => {
      const s = await shipper();
      const c = await carrier();
      const il = await loadBetween(s, s.origin, s.dest); // Chicago, IL -> Dallas, TX
      await postLoad(s, il);
      const co = await loadBetween(s, s.a, s.dest); // Denver, CO -> Dallas, TX
      await postLoad(s, co);

      const body = await listMarketplace(c.cookie, { originState: "IL" });
      const ids = body.data.map((l: { id: string }) => l.id);
      expect(ids).toContain(il);
      expect(ids).not.toContain(co);
    });

    it("destinationState narrows correctly", async () => {
      const s = await shipper();
      const c = await carrier();
      const toTx = await loadBetween(s, s.origin, s.dest); // -> Dallas, TX
      await postLoad(s, toTx);
      const toNv = await loadBetween(s, s.origin, s.z); // -> Reno, NV
      await postLoad(s, toNv);

      const body = await listMarketplace(c.cookie, { destinationState: "NV" });
      const ids = body.data.map((l: { id: string }) => l.id);
      expect(ids).toContain(toNv);
      expect(ids).not.toContain(toTx);
    });

    it("equipmentType filter narrows within profile eligibility, and can never broaden past it", async () => {
      const s = await shipper();
      // Carrier profile restricted to DRY_VAN only.
      const c = await carrier("Dry Van Carrier", { equipmentTypes: ["DRY_VAN"] });
      const dryVan = await loadBetween(s, s.origin, s.dest, { equipmentType: "DRY_VAN" });
      await postLoad(s, dryVan);
      const reefer = await loadBetween(s, s.origin, s.dest, { equipmentType: "REEFER" });
      await postLoad(s, reefer);

      // Filtering for the carrier's own eligible equipment: works normally.
      const dryVanResult = await listMarketplace(c.cookie, { equipmentType: "DRY_VAN" });
      expect(dryVanResult.data.map((l: { id: string }) => l.id)).toContain(dryVan);

      // Filtering for equipment OUTSIDE the carrier's profile: the filter
      // cannot broaden eligibility — zero rows, not the reefer load.
      const reeferResult = await listMarketplace(c.cookie, { equipmentType: "REEFER" });
      expect(reeferResult.data).toEqual([]);
      expect(JSON.stringify(reeferResult)).not.toContain(reefer);
    });

    it("pickupFrom/pickupTo narrows to the requested window", async () => {
      const s = await shipper();
      const c = await carrier();
      const soon = await loadBetween(s, s.origin, s.dest, {
        pickupWindowStart: future(2),
        pickupWindowEnd: future(2, 16),
      });
      await postLoad(s, soon);
      const later = await loadBetween(s, s.origin, s.dest, {
        pickupWindowStart: future(20),
        pickupWindowEnd: future(20, 16),
        deliveryWindowStart: future(22),
        deliveryWindowEnd: future(22, 17),
      });
      await postLoad(s, later);

      const body = await listMarketplace(c.cookie, {
        pickupFrom: future(0),
        pickupTo: future(5),
      });
      const ids = body.data.map((l: { id: string }) => l.id);
      expect(ids).toContain(soon);
      expect(ids).not.toContain(later);
    });

    it("combined filters compose correctly (AND, not OR)", async () => {
      const s = await shipper();
      const c = await carrier();
      const match = await loadBetween(s, s.origin, s.dest, { equipmentType: "DRY_VAN" });
      await postLoad(s, match);
      // Right equipment, wrong origin state.
      const wrongOrigin = await loadBetween(s, s.a, s.dest, { equipmentType: "DRY_VAN" });
      await postLoad(s, wrongOrigin);

      const body = await listMarketplace(c.cookie, { originState: "IL", equipmentType: "DRY_VAN" });
      expect(body.data.map((l: { id: string }) => l.id)).toEqual([match]);
    });

    it("pagination total reflects the filtered set, not the full board", async () => {
      const s = await shipper();
      const c = await carrier();
      for (let i = 0; i < 2; i++) {
        const id = await loadBetween(s, s.origin, s.dest);
        await postLoad(s, id);
      }
      const unrelated = await loadBetween(s, s.a, s.dest);
      await postLoad(s, unrelated);

      const body = await listMarketplace(c.cookie, { originState: "IL" });
      expect(body.total).toBe(2);
    });

    it("a blocked shipper's freight stays hidden even when every filter matches", async () => {
      const s = await shipper();
      const c = await carrier();
      const blocked = await loadBetween(s, s.origin, s.dest, { equipmentType: "DRY_VAN" });
      await postLoad(s, blocked);
      await api.inject(
        authed(c.cookie, { method: "POST", url: `/api/companies/${s.companyId}/block` }),
      );

      const body = await listMarketplace(c.cookie, { originState: "IL", equipmentType: "DRY_VAN" });
      expect(body.data).toEqual([]);
      expect(JSON.stringify(body)).not.toContain(blocked);
    });

    it("myThread / awaitingMyResponse remain carrier-specific under filtering", async () => {
      const s = await shipper();
      const c1 = await carrier("Carrier One");
      const c2 = await carrier("Carrier Two");
      const loadId = await loadBetween(s, s.origin, s.dest, { equipmentType: "DRY_VAN" });
      await postLoad(s, loadId);
      await api.inject(
        authed(c1.cookie, {
          method: "POST",
          url: `/api/marketplace/loads/${loadId}/offers`,
          payload: { amount: "900.00", currency: "USD" },
        }),
      );

      const asC1 = await listMarketplace(c1.cookie, { originState: "IL" });
      const row1 = asC1.data.find((l: { id: string }) => l.id === loadId);
      expect(row1.myThread).not.toBeNull();

      const asC2 = await listMarketplace(c2.cookie, { originState: "IL" });
      const row2 = asC2.data.find((l: { id: string }) => l.id === loadId);
      expect(row2.myThread).toBeNull();
      expect(JSON.stringify(asC2)).not.toContain("900.00");
    });

    it("Rate/RPM behavior is unchanged by filtering (mock-provider-free, computed only when both facts exist)", async () => {
      const s = await shipper();
      const c = await carrier();
      const published = await loadBetween(s, s.origin, s.dest, {
        equipmentType: "DRY_VAN",
        commercialMode: "PUBLISH_RATE",
        postedRate: "1500.00",
      });
      await postLoad(s, published);

      const body = await listMarketplace(c.cookie, { originState: "IL" });
      const row = body.data.find((l: { id: string }) => l.id === published);
      expect(row.postedRate).toBe("1500.00");
      expect(row.ratePerMile).not.toBeNull();
    });
  });
});
