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
 * M4 Phase 9 — Correctness & Truthfulness Fixes.
 *
 * (1) Pending-block auto-activation: a block requested during active shared
 *     freight must automatically become ACTIVE once ALL active shared
 *     freight between the two companies has ended (completion OR
 *     cancellation of an awarded load) — not just when someone happens to
 *     call the manual NETWORK_MANAGE recheck endpoint.
 *
 * (2) Losing-carrier truthful history: a carrier with a real offer thread on
 *     a load that was covered by someone else must see its own truthful
 *     "Load Covered" commercial history via GET /offers/threads/:threadId
 *     instead of the generic 404 the old marketplace/load-detail fallback
 *     produced — with zero leakage of the winner's identity, rate, or any
 *     other carrier's data.
 */
suite("Phase 9 — correctness & truthfulness (integration)", () => {
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

  type ShipperFx = Session & { origin: string; dest: string };

  async function shipper(name = "Acme Freight"): Promise<ShipperFx> {
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

  async function loadBetween(s: Session, originId: string, destId: string): Promise<string> {
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

  /** Post -> a single carrier offers -> shipper accepts. Auto-assigns. */
  async function assignLoad(s: Session, c: Session, loadId: string, amount = "1000.00"): Promise<string> {
    await postLoad(s, loadId);
    const offer = await api.inject(
      authed(c.cookie, {
        method: "POST",
        url: `/api/marketplace/loads/${loadId}/offers`,
        payload: { amount, currency: "USD" },
      }),
    );
    if (offer.statusCode !== 201) throw new Error(`offer ${offer.statusCode}: ${offer.body}`);
    const roundId = offer.json().rounds[0].id;
    const accept = await api.inject(
      authed(s.cookie, { method: "POST", url: `/api/offers/rounds/${roundId}/accept` }),
    );
    if (accept.statusCode !== 200) throw new Error(`accept ${accept.statusCode}: ${accept.body}`);
    return offer.json().threadId as string;
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

  /** Drive an AWARDED load all the way to COMPLETED via its assigned carrier. */
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

  async function block(blocker: Session, blockedCompanyId: string): Promise<{ id: string }> {
    const res = await api.inject(
      authed(blocker.cookie, { method: "POST", url: `/api/companies/${blockedCompanyId}/block` }),
    );
    if (res.statusCode !== 201) throw new Error(`block ${res.statusCode}: ${res.body}`);
    return res.json();
  }

  async function getBlocks(blocker: Session): Promise<
    { id: string; blockedCompanyId: string; status: string; effectiveAt: string | null }[]
  > {
    const res = await api.inject(authed(blocker.cookie, { method: "GET", url: "/api/blocks" }));
    expect(res.statusCode).toBe(200);
    return res.json().data;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Block continuity — 8 required scenarios
  // ═══════════════════════════════════════════════════════════════════

  describe("pending block auto-activation", () => {
    it("1. pending block + one active shared shipment -> completes -> block automatically ACTIVE", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await loadBetween(s, s.origin, s.dest);
      await assignLoad(s, c, loadId);

      const created = await block(s, c.companyId);
      expect((await getBlocks(s)).find((b) => b.id === created.id)?.status).toBe(
        "PENDING_ON_COMPLETION",
      );

      await completeLoad(s, c, loadId);

      const after = await getBlocks(s);
      const row = after.find((b) => b.id === created.id)!;
      expect(row.status).toBe("ACTIVE");
      expect(row.effectiveAt).not.toBeNull();
    });

    it("2. pending block + TWO active shared shipments -> first completes -> block remains PENDING_ON_COMPLETION", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadA = await loadBetween(s, s.origin, s.dest);
      const loadB = await loadBetween(s, s.origin, s.dest);
      await assignLoad(s, c, loadA);
      await assignLoad(s, c, loadB);

      const created = await block(s, c.companyId);
      await completeLoad(s, c, loadA);

      const row = (await getBlocks(s)).find((b) => b.id === created.id)!;
      expect(row.status).toBe("PENDING_ON_COMPLETION");
      expect(row.effectiveAt).toBeNull();
    });

    it("3. ...then the SECOND shared shipment completes -> block becomes ACTIVE", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadA = await loadBetween(s, s.origin, s.dest);
      const loadB = await loadBetween(s, s.origin, s.dest);
      await assignLoad(s, c, loadA);
      await assignLoad(s, c, loadB);

      const created = await block(s, c.companyId);
      await completeLoad(s, c, loadA);
      await completeLoad(s, c, loadB);

      const row = (await getBlocks(s)).find((b) => b.id === created.id)!;
      expect(row.status).toBe("ACTIVE");
      expect(row.effectiveAt).not.toBeNull();
    });

    it("4. cancelling the awarded load (not completing it) also ends active freight -> block becomes ACTIVE", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await loadBetween(s, s.origin, s.dest);
      await assignLoad(s, c, loadId);

      const created = await block(s, c.companyId);
      expect((await getBlocks(s)).find((b) => b.id === created.id)?.status).toBe(
        "PENDING_ON_COMPLETION",
      );

      const cancel = await api.inject(
        authed(s.cookie, { method: "POST", url: `/api/loads/${loadId}/cancel` }),
      );
      expect(cancel.statusCode).toBe(200);

      const row = (await getBlocks(s)).find((b) => b.id === created.id)!;
      expect(row.status).toBe("ACTIVE");
    });

    it("5. a block requested from the CARRIER's direction behaves identically", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await loadBetween(s, s.origin, s.dest);
      await assignLoad(s, c, loadId);

      // Carrier blocks the shipper this time.
      const created = await block(c, s.companyId);
      expect((await getBlocks(c)).find((b) => b.id === created.id)?.status).toBe(
        "PENDING_ON_COMPLETION",
      );

      await completeLoad(s, c, loadId);

      const row = (await getBlocks(c)).find((b) => b.id === created.id)!;
      expect(row.status).toBe("ACTIVE");
    });

    it("6. an already-ACTIVE block (no active freight at creation) is untouched by an unrelated completion — no duplicate activation", async () => {
      const s = await shipper();
      const c = await carrier();
      // No freight yet -> block starts ACTIVE immediately.
      const created = await block(s, c.companyId);
      const initial = (await getBlocks(s)).find((b) => b.id === created.id)!;
      expect(initial.status).toBe("ACTIVE");
      const originalEffectiveAt = initial.effectiveAt;

      // Freight can still exist even with an ACTIVE (in-force) block only if
      // it was awarded before the block — not reachable here, so instead
      // prove idempotency the direct way: a second company's freight
      // completing must not touch this pair's already-ACTIVE block at all.
      const otherCarrier = await carrier("Other Carrier");
      const otherLoad = await loadBetween(s, s.origin, s.dest);
      await assignLoad(s, otherCarrier, otherLoad);
      await completeLoad(s, otherCarrier, otherLoad);

      const after = (await getBlocks(s)).find((b) => b.id === created.id)!;
      expect(after.status).toBe("ACTIVE");
      expect(after.effectiveAt).toBe(originalEffectiveAt);
    });

    it("7. concurrent completion of the final two shared shipments produces exactly one consistent ACTIVE state, no duplicate/contradictory result", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadA = await loadBetween(s, s.origin, s.dest);
      const loadB = await loadBetween(s, s.origin, s.dest);
      await assignLoad(s, c, loadA);
      await assignLoad(s, c, loadB);
      const created = await block(s, c.companyId);

      // Drive both to DELIVERED + approved POD first, then fire both
      // /complete calls concurrently.
      for (const loadId of [loadA, loadB]) {
        for (const verb of ["pickup", "in-transit", "deliver"] as const) {
          expect((await op(c.cookie, loadId, verb)).statusCode).toBe(200);
        }
        const docId = await uploadAndConfirmPod(c, loadId);
        expect(
          (await api.inject(authed(s.cookie, { method: "POST", url: `/api/load-documents/${docId}/approve` })))
            .statusCode,
        ).toBe(200);
      }

      const [r1, r2] = await Promise.all([
        api.inject(authed(s.cookie, { method: "POST", url: `/api/loads/${loadA}/complete` })),
        api.inject(authed(s.cookie, { method: "POST", url: `/api/loads/${loadB}/complete` })),
      ]);
      expect(r1.statusCode).toBe(200);
      expect(r2.statusCode).toBe(200);

      const row = (await getBlocks(s)).find((b) => b.id === created.id)!;
      expect(row.status).toBe("ACTIVE");
      expect(row.effectiveAt).not.toBeNull();
    });

    it("8. after activation, existing block-in-force eligibility rules are respected exactly as before (no regression)", async () => {
      const s = await shipper();
      const c = await carrier();
      const loadId = await loadBetween(s, s.origin, s.dest);
      await assignLoad(s, c, loadId);
      await block(s, c.companyId);
      await completeLoad(s, c, loadId);

      // Post-activation: the now-fully-ACTIVE block still correctly excludes
      // this carrier from the shipper's marketplace-visible board via the
      // existing, unchanged resolveBlockedShipperIds/audience filtering —
      // the exact same exclusion that already applied while PENDING.
      const freshLoad = await loadBetween(s, s.origin, s.dest);
      await postLoad(s, freshLoad);
      const board = await api.inject(
        authed(c.cookie, { method: "GET", url: "/api/marketplace/loads" }),
      );
      expect(board.json().data.map((l: { id: string }) => l.id)).not.toContain(freshLoad);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Losing-carrier truthful history — matrix A-J
  // ═══════════════════════════════════════════════════════════════════

  describe("losing-carrier truthful history", () => {
    async function coveredScenario() {
      const s = await shipper();
      const winner = await carrier("Winning Carrier");
      const loser = await carrier("Losing Carrier");
      const loadId = await loadBetween(s, s.origin, s.dest);
      await postLoad(s, loadId);

      const loserOffer = await api.inject(
        authed(loser.cookie, {
          method: "POST",
          url: `/api/marketplace/loads/${loadId}/offers`,
          payload: { amount: "800.00", currency: "USD" },
        }),
      );
      expect(loserOffer.statusCode).toBe(201);
      const loserThreadId = loserOffer.json().threadId as string;

      // Load is already POSTED (above) — offer + accept directly rather than
      // via assignLoad(), which would try to /post an already-posted load.
      const winnerOffer = await api.inject(
        authed(winner.cookie, {
          method: "POST",
          url: `/api/marketplace/loads/${loadId}/offers`,
          payload: { amount: "1200.00", currency: "USD" },
        }),
      );
      expect(winnerOffer.statusCode).toBe(201);
      const winnerThreadId = winnerOffer.json().threadId as string;
      const winnerRoundId = winnerOffer.json().rounds[0].id;
      const accept = await api.inject(
        authed(s.cookie, { method: "POST", url: `/api/offers/rounds/${winnerRoundId}/accept` }),
      );
      expect(accept.statusCode).toBe(200);

      return { s, winner, loser, loadId, loserThreadId, winnerThreadId };
    }

    it("A. losing carrier can access its own truthful covered-state commercial history", async () => {
      const { loser, loadId, loserThreadId } = await coveredScenario();

      const summary = await api.inject(
        authed(loser.cookie, { method: "GET", url: `/api/marketplace/loads/${loadId}/offers` }),
      );
      expect(summary.statusCode).toBe(200);
      expect(summary.json().thread.threadId).toBe(loserThreadId);
      expect(summary.json().thread.status).toBe("REJECTED");
      expect(summary.json().thread.closedReason).toBe("load_awarded_to_other");

      const detail = await api.inject(
        authed(loser.cookie, { method: "GET", url: `/api/offers/threads/${loserThreadId}` }),
      );
      expect(detail.statusCode).toBe(200);
      const body = detail.json();
      expect(body.status).toBe("REJECTED");
      expect(body.closedReason).toBe("load_awarded_to_other");
      expect(body.load.referenceNumber).toBeTruthy();
      expect(body.currentAmount).toBe("800.00");
    });

    it("B. losing carrier cannot see the winner's company identity", async () => {
      const { loser, loserThreadId, winner } = await coveredScenario();
      const detail = await api.inject(
        authed(loser.cookie, { method: "GET", url: `/api/offers/threads/${loserThreadId}` }),
      );
      expect(detail.statusCode).toBe(200);
      const raw = JSON.stringify(detail.json());
      expect(raw).not.toContain(winner.companyId);
      expect(raw.toLowerCase()).not.toContain("winning carrier");
      expect(detail.json().carrier).toBeNull();
    });

    it("C. losing carrier cannot see the winning rate", async () => {
      const { loser, loserThreadId } = await coveredScenario();
      const detail = await api.inject(
        authed(loser.cookie, { method: "GET", url: `/api/offers/threads/${loserThreadId}` }),
      );
      const raw = JSON.stringify(detail.json());
      expect(raw).not.toContain("1200.00"); // the winning amount
      // Every round amount present belongs to the loser's own thread only.
      for (const r of detail.json().rounds) {
        expect(r.amount).toBe("800.00");
      }
    });

    it("D. losing carrier cannot read the winner's own thread directly", async () => {
      const { loser, winnerThreadId } = await coveredScenario();
      const res = await api.inject(
        authed(loser.cookie, { method: "GET", url: `/api/offers/threads/${winnerThreadId}` }),
      );
      expect(res.statusCode).toBe(404);
    });

    it("E. losing carrier cannot see the Rate Confirmation", async () => {
      const { loser, loadId } = await coveredScenario();
      const res = await api.inject(
        authed(loser.cookie, { method: "GET", url: `/api/loads/${loadId}/rate-confirmation` }),
      );
      expect(res.statusCode).toBe(404);
    });

    it("F. losing carrier cannot see shipment operational/check-in/document/POD data", async () => {
      const { loser, loadId } = await coveredScenario();
      const docs = await api.inject(
        authed(loser.cookie, { method: "GET", url: `/api/loads/${loadId}/documents` }),
      );
      expect(docs.statusCode).toBe(404);
      const checkIns = await api.inject(
        authed(loser.cookie, { method: "GET", url: `/api/loads/${loadId}/check-ins` }),
      );
      expect(checkIns.statusCode).toBe(404);
      const loadDetail = await api.inject(
        authed(loser.cookie, { method: "GET", url: `/api/loads/${loadId}` }),
      );
      expect(loadDetail.statusCode).toBe(404);
    });

    it("G. an unrelated carrier (never had a thread) cannot use the historical path", async () => {
      const { loadId } = await coveredScenario();
      const unrelated = await carrier("Unrelated Carrier");

      const summary = await api.inject(
        authed(unrelated.cookie, { method: "GET", url: `/api/marketplace/loads/${loadId}/offers` }),
      );
      expect(summary.statusCode).toBe(200);
      expect(summary.json().thread).toBeNull();

      const marketDetail = await api.inject(
        authed(unrelated.cookie, { method: "GET", url: `/api/marketplace/loads/${loadId}` }),
      );
      expect(marketDetail.statusCode).toBe(404);
      const loadDetail = await api.inject(
        authed(unrelated.cookie, { method: "GET", url: `/api/loads/${loadId}` }),
      );
      expect(loadDetail.statusCode).toBe(404);
    });

    it("H. the winning carrier still gets full authorized shipment access", async () => {
      const { winner, loadId } = await coveredScenario();
      const res = await api.inject(
        authed(winner.cookie, { method: "GET", url: `/api/loads/${loadId}` }),
      );
      expect(res.statusCode).toBe(200);
      // Acceptance auto-assigns the carrier atomically (Milestone 4 Phase 5)
      // — the load is already CARRIER_ASSIGNED, not merely AWARDED.
      expect(res.json().status).toBe("CARRIER_ASSIGNED");
    });

    it("I. the shipper still gets full authorized commercial/operational access", async () => {
      const { s, loadId } = await coveredScenario();
      const res = await api.inject(authed(s.cookie, { method: "GET", url: `/api/loads/${loadId}` }));
      expect(res.statusCode).toBe(200);
      const rc = await api.inject(
        authed(s.cookie, { method: "GET", url: `/api/loads/${loadId}/rate-confirmation` }),
      );
      expect(rc.statusCode).toBe(200);
    });

    it("J. facility-scoped shipper behavior is unchanged by the Phase 9 changes", async () => {
      const s = await shipper();
      const a = await createLocation(api, s.cookie, { name: "A", city: "Denver", state: "CO" });
      const z = await createLocation(api, s.cookie, { name: "Z", city: "Reno", state: "NV" });
      const dispA = await dispatcher(s, "phase9-scope", [a]);
      const c = await carrier();

      const inScope = await loadBetween(s, a, s.dest);
      const outOfScope = await loadBetween(s, z, s.dest);

      const inScopeRead = await api.inject(
        authed(dispA.cookie, { method: "GET", url: `/api/loads/${inScope}` }),
      );
      expect(inScopeRead.statusCode).toBe(200);
      const outOfScopeRead = await api.inject(
        authed(dispA.cookie, { method: "GET", url: `/api/loads/${outOfScope}` }),
      );
      expect(outOfScopeRead.statusCode).toBe(404);

      // And the new complete()/cancel() continuity call sites don't weaken
      // this — an out-of-scope cancel is still denied.
      const cancelDenied = await api.inject(
        authed(dispA.cookie, { method: "POST", url: `/api/loads/${outOfScope}/cancel` }),
      );
      expect(cancelDenied.statusCode).toBe(404);
      void c;
    });
  });
});
