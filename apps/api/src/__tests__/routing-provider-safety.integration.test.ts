import type { PrismaClient } from "@loadtopia/db";
import type {
  GeocodingProvider,
  ProviderHealth,
  RouteRequest,
  RouteResult,
  RoutingProvider,
} from "@loadtopia/providers";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { allMockProviders } from "./helpers";
import {
  authed,
  createLocation,
  makeAppWithProviders,
  makePrisma,
  registerCompany,
  resetDb,
  TEST_DB_URL,
} from "./it-harness";

const suite = TEST_DB_URL ? describe : describe.skip;

/**
 * A minimal, deterministic stand-in for GoogleRoutingProvider. Proves the
 * `isMock` provenance fix and the posting-safety guard end-to-end WITHOUT any
 * real network call or the real adapter's HTTP plumbing — that plumbing
 * (timeouts, retries, response validation) is already covered in
 * `packages/providers/src/google/*.test.ts`. Only `name`/`isMock` need to
 * match what `GoogleRoutingProvider` reports for these tests to be valid.
 */
class FakeRealRoutingProvider implements RoutingProvider {
  readonly name = "google";
  readonly isMock = false;
  callCount = 0;
  constructor(private readonly behavior: "succeed" | "fail" = "succeed") {}

  async getRoute(_req: RouteRequest): Promise<RouteResult> {
    this.callCount += 1;
    if (this.behavior === "fail") throw new Error("simulated real-provider routing failure");
    return {
      distanceMeters: 4_264_000, // ~2,650 mi, a realistic VA -> CA road distance
      durationSeconds: 144_000,
      provider: this.name,
      isMock: false,
      retrievedAt: new Date().toISOString(),
    };
  }

  async health(): Promise<ProviderHealth> {
    return { status: "ok", isMock: false };
  }
}

/**
 * A minimal stand-in for GoogleGeocodingProvider that always resolves — used
 * wherever a test needs a Location that is genuinely (not mock-) geocoded, so
 * it can exercise "real routing succeeds" without also exercising the
 * mock-coordinate provenance guard (see routing.ts's computeRouting()).
 */
function googleGeocoding(): GeocodingProvider {
  return {
    name: "google",
    isMock: false,
    geocode: async (address) => ({
      point: { latitude: 38.6558, longitude: -77.2517 },
      normalizedAddress: { ...address, country: address.country || "US" },
      provider: "google",
      isMock: false,
      retrievedAt: new Date().toISOString(),
    }),
    health: async () => ({ status: "ok", isMock: false }),
  };
}

const future = (days: number, hour = 8) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

const draftPayload = (origin: string, dest: string) => ({
  originLocationId: origin,
  destinationLocationId: dest,
  equipmentType: "DRY_VAN",
  mode: "FTL",
  commodity: "Palletized dry goods",
  weightLbs: 38_000,
  pickupWindowStart: future(3, 8),
  pickupWindowEnd: future(3, 16),
  deliveryWindowStart: future(5, 8),
  deliveryWindowEnd: future(5, 17),
});

suite("routing provider provenance + posting safety (integration)", () => {
  let prisma: PrismaClient;

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
  });

  async function shipperWithLocations(api: FastifyInstance) {
    const s = await registerCompany(api, { companyName: "Provenance Co" });
    const origin = await createLocation(api, s.cookie, { name: "Origin", city: "Woodbridge", state: "VA" });
    const dest = await createLocation(api, s.cookie, { name: "Dest", city: "Beverly Hills", state: "CA" });
    return { ...s, origin, dest };
  }

  describe("historical isMock derivation (per-load provenance, not the current registry)", () => {
    it("a load routed by mock keeps isMock: true even after the registry switches to a real provider", async () => {
      const mockApi = await makeAppWithProviders(prisma, allMockProviders());
      const s = await shipperWithLocations(mockApi);
      const created = await mockApi.inject(
        authed(s.cookie, { method: "POST", url: "/api/loads", payload: draftPayload(s.origin, s.dest) }),
      );
      expect(created.json().routing.provider).toBe("mock");
      expect(created.json().routing.isMock).toBe(true);
      const id = created.json().id;
      await mockApi.close();

      // A DIFFERENT app instance, now configured with a real (isMock: false)
      // routing provider — simulates a production cutover to Google. The
      // load's OWN stored provider name ("mock") must still drive its isMock
      // flag; it must never be relabeled "real" just because the registry's
      // active adapter changed later.
      const googleApi = await makeAppWithProviders(prisma, {
        ...allMockProviders(),
        routing: new FakeRealRoutingProvider("succeed"),
      });
      const read = await googleApi.inject(authed(s.cookie, { method: "GET", url: `/api/loads/${id}` }));
      expect(read.statusCode).toBe(200);
      expect(read.json().routing.provider).toBe("mock");
      expect(read.json().routing.isMock).toBe(true);
      await googleApi.close();
    });

    it("a load routed by the real (google-named) provider is isMock: false", async () => {
      const googleApi = await makeAppWithProviders(prisma, {
        ...allMockProviders(),
        routing: new FakeRealRoutingProvider("succeed"),
        // Locations must be genuinely geocoded by a real provider here — the
        // coordinate-provenance guard in routing.ts correctly refuses to route
        // mock-geocoded coordinates under a real routing provider (see the
        // dedicated "coordinate provenance guard" describe block below).
        geocoding: googleGeocoding(),
      });
      const s = await shipperWithLocations(googleApi);
      const created = await googleApi.inject(
        authed(s.cookie, { method: "POST", url: "/api/loads", payload: draftPayload(s.origin, s.dest) }),
      );
      expect(created.json().routing.provider).toBe("google");
      expect(created.json().routing.isMock).toBe(false);
      // A realistic cross-country distance, not the ~132 mi mock-haversine artifact.
      expect(created.json().routing.miles).toBeGreaterThan(2_000);
      await googleApi.close();
    });

    it("a load with no routing provider at all (never routed) is isMock: false, not true", async () => {
      const failingApi = await makeAppWithProviders(prisma, {
        ...allMockProviders(),
        routing: new FakeRealRoutingProvider("fail"),
      });
      const s = await shipperWithLocations(failingApi);
      const created = await failingApi.inject(
        authed(s.cookie, { method: "POST", url: "/api/loads", payload: draftPayload(s.origin, s.dest) }),
      );
      expect(created.json().routing.provider).toBeNull();
      expect(created.json().routing.isMock).toBe(false);
      await failingApi.close();
    });
  });

  describe("posting safety under a real routing provider", () => {
    it("draft creation still succeeds when the real routing provider fails (never blocks on provider availability)", async () => {
      const failingApi = await makeAppWithProviders(prisma, {
        ...allMockProviders(),
        routing: new FakeRealRoutingProvider("fail"),
      });
      const s = await shipperWithLocations(failingApi);
      const created = await failingApi.inject(
        authed(s.cookie, { method: "POST", url: "/api/loads", payload: draftPayload(s.origin, s.dest) }),
      );
      expect(created.statusCode).toBe(201);
      expect(created.json().status).toBe("DRAFT");
      expect(created.json().routing.miles).toBeNull();
      await failingApi.close();
    });

    it("posting is blocked with a clear error when the real provider failed to produce a distance", async () => {
      const failingApi = await makeAppWithProviders(prisma, {
        ...allMockProviders(),
        routing: new FakeRealRoutingProvider("fail"),
      });
      const s = await shipperWithLocations(failingApi);
      const created = await failingApi.inject(
        authed(s.cookie, { method: "POST", url: "/api/loads", payload: draftPayload(s.origin, s.dest) }),
      );
      const id = created.json().id;

      const post = await failingApi.inject(authed(s.cookie, { method: "POST", url: `/api/loads/${id}/post` }));
      expect(post.statusCode).toBe(409);
      expect(post.json().error.message).toMatch(/Route mileage could not be calculated/);

      const load = await prisma.load.findUniqueOrThrow({ where: { id } });
      expect(load.status).toBe("DRAFT"); // never transitioned to POSTED

      // The specific invariant this guard exists for: no synthetic-lane-mile
      // pricing snapshot was silently created as if routing had succeeded.
      const snapshots = await prisma.pricingSnapshot.count({ where: { loadId: id } });
      expect(snapshots).toBe(0);
      await failingApi.close();
    });

    it("posting succeeds normally once the real routing provider has produced a valid distance", async () => {
      const okApi = await makeAppWithProviders(prisma, {
        ...allMockProviders(),
        routing: new FakeRealRoutingProvider("succeed"),
        geocoding: googleGeocoding(), // genuinely geocoded — the guard must not block this
      });
      const s = await shipperWithLocations(okApi);
      const created = await okApi.inject(
        authed(s.cookie, { method: "POST", url: "/api/loads", payload: draftPayload(s.origin, s.dest) }),
      );
      const id = created.json().id;

      const post = await okApi.inject(authed(s.cookie, { method: "POST", url: `/api/loads/${id}/post` }));
      expect(post.statusCode).toBe(200);
      expect(post.json().status).toBe("POSTED");

      const snapshots = await prisma.pricingSnapshot.count({ where: { loadId: id } });
      expect(snapshots).toBe(1);
      await okApi.close();
    });

    it("mock-only local/test posting is unaffected — mock routing never fails, so the guard never triggers", async () => {
      const mockApi = await makeAppWithProviders(prisma, allMockProviders());
      const s = await shipperWithLocations(mockApi);
      const created = await mockApi.inject(
        authed(s.cookie, { method: "POST", url: "/api/loads", payload: draftPayload(s.origin, s.dest) }),
      );
      const id = created.json().id;
      const post = await mockApi.inject(authed(s.cookie, { method: "POST", url: `/api/loads/${id}/post` }));
      expect(post.statusCode).toBe(200);
      await mockApi.close();
    });
  });

  describe("coordinate provenance guard: mock-geocoded Location + real routing provider", () => {
    it("a Location geocoded by mock, used under a real routing provider: draft succeeds, routing provider is never called, distanceMeters stays null, and posting is blocked by the existing guard", async () => {
      const fakeRouting = new FakeRealRoutingProvider("succeed");
      const api = await makeAppWithProviders(prisma, {
        ...allMockProviders(), // GEOCODING_PROVIDER stays mock, same as production pre-cutover
        routing: fakeRouting, // ROUTING_PROVIDER is now the real (isMock: false) adapter
      });
      const s = await registerCompany(api, { companyName: "Provenance Guard Co" });
      // createLocation() geocodes through this app's (mock) GeocodingProvider,
      // producing exactly the pre-cutover state under test: geocoded_by = "mock".
      const origin = await createLocation(api, s.cookie, { name: "Origin", city: "Woodbridge", state: "VA" });
      const dest = await createLocation(api, s.cookie, { name: "Dest", city: "Beverly Hills", state: "CA" });
      const originRow = await prisma.location.findUniqueOrThrow({ where: { id: origin } });
      expect(originRow.geocodedBy).toBe("mock");
      expect(originRow.latitude).not.toBeNull(); // geocoded, just by mock

      const created = await api.inject(
        authed(s.cookie, { method: "POST", url: "/api/loads", payload: draftPayload(origin, dest) }),
      );
      expect(created.statusCode).toBe(201);
      expect(created.json().status).toBe("DRAFT");
      expect(created.json().routing.miles).toBeNull();
      expect(created.json().routing.provider).toBeNull();
      expect(created.json().routing.isMock).toBe(false); // never-routed, per the isMock derivation rule
      expect(fakeRouting.callCount).toBe(0); // the real provider was NEVER asked to route these coordinates
      const id = created.json().id;

      const row = await prisma.load.findUniqueOrThrow({ where: { id } });
      expect(row.distanceMeters).toBeNull();
      expect(row.driveTimeMinutes).toBeNull();
      expect(row.routingProvider).toBeNull();

      // The EXISTING (unmodified) posting-safety guard — not new logic — blocks
      // posting because distanceMeters is still null under a real provider.
      const post = await api.inject(authed(s.cookie, { method: "POST", url: `/api/loads/${id}/post` }));
      expect(post.statusCode).toBe(409);
      expect(post.json().error.message).toMatch(/Route mileage could not be calculated/);

      const snapshots = await prisma.pricingSnapshot.count({ where: { loadId: id } });
      expect(snapshots).toBe(0);
      await api.close();
    });

    it("a Location genuinely geocoded by the real provider routes normally under that same provider", async () => {
      const fakeRouting = new FakeRealRoutingProvider("succeed");
      const api = await makeAppWithProviders(prisma, {
        ...allMockProviders(),
        routing: fakeRouting,
        geocoding: googleGeocoding(),
      });
      const s = await registerCompany(api, { companyName: "Real Geocode Co" });
      const origin = await createLocation(api, s.cookie, { name: "Origin", city: "Woodbridge", state: "VA" });
      const dest = await createLocation(api, s.cookie, { name: "Dest", city: "Beverly Hills", state: "CA" });
      const originRow = await prisma.location.findUniqueOrThrow({ where: { id: origin } });
      expect(originRow.geocodedBy).toBe("google");

      const created = await api.inject(
        authed(s.cookie, { method: "POST", url: "/api/loads", payload: draftPayload(origin, dest) }),
      );
      expect(created.statusCode).toBe(201);
      expect(created.json().routing.provider).toBe("google");
      expect(created.json().routing.isMock).toBe(false);
      expect(created.json().routing.miles).toBeGreaterThan(0);
      expect(fakeRouting.callCount).toBe(1); // the guard did not block a legitimate real-provider Location
      await api.close();
    });

    it("switching providers and merely READING an existing load never reroutes it (no automatic rerouting on cutover)", async () => {
      const mockApi = await makeAppWithProviders(prisma, allMockProviders());
      const s = await shipperWithLocations(mockApi);
      const created = await mockApi.inject(
        authed(s.cookie, { method: "POST", url: "/api/loads", payload: draftPayload(s.origin, s.dest) }),
      );
      const id = created.json().id;
      const before = await prisma.load.findUniqueOrThrow({ where: { id } });
      await mockApi.close();

      const fakeRouting = new FakeRealRoutingProvider("succeed");
      const googleApi = await makeAppWithProviders(prisma, { ...allMockProviders(), routing: fakeRouting });
      const read = await googleApi.inject(authed(s.cookie, { method: "GET", url: `/api/loads/${id}` }));
      expect(read.statusCode).toBe(200);
      expect(fakeRouting.callCount).toBe(0); // reading never triggers a re-route

      const after = await prisma.load.findUniqueOrThrow({ where: { id } });
      expect(after.distanceMeters).toEqual(before.distanceMeters);
      expect(after.driveTimeMinutes).toEqual(before.driveTimeMinutes);
      expect(after.routingProvider).toBe(before.routingProvider);
      expect(after.routedAt).toEqual(before.routedAt);
      expect(read.json().routing.isMock).toBe(true); // historical provenance intact
      await googleApi.close();
    });
  });

  describe("pricing interaction (no PricingProvider change)", () => {
    it("the persisted real route distance reaches MockPricingProvider at post time", async () => {
      const okApi = await makeAppWithProviders(prisma, {
        ...allMockProviders(),
        routing: new FakeRealRoutingProvider("succeed"),
        geocoding: googleGeocoding(), // genuinely geocoded — the guard must not block this
      });
      const s = await shipperWithLocations(okApi);
      const created = await okApi.inject(
        authed(s.cookie, { method: "POST", url: "/api/loads", payload: draftPayload(s.origin, s.dest) }),
      );
      const id = created.json().id;
      await okApi.inject(authed(s.cookie, { method: "POST", url: `/api/loads/${id}/post` }));

      const snapshot = await prisma.pricingSnapshot.findFirstOrThrow({ where: { loadId: id } });
      // The REAL persisted distance, not a synthetic lane length.
      expect(snapshot.distanceMeters).toBe(4_264_000);
      // Pricing itself is still mock — only mileage became real. Never
      // represent this as real market pricing.
      expect(snapshot.isMock).toBe(true);
      expect(snapshot.confidence).toBe("low");
      expect(snapshot.disclaimer).toBeTruthy();
      // MockPricingProvider computes mid = miles * rpm with rpm in [1.6, 3.4]
      // (see mock-pricing-provider.ts) — assert the persisted distance, not a
      // fully-synthetic laneMiles() distance, was what fed the calculation.
      const miles = 4_264_000 / 1609.344;
      expect(Number(snapshot.midRate)).toBeGreaterThanOrEqual(miles * 1.6 * 0.99);
      expect(Number(snapshot.midRate)).toBeLessThanOrEqual(miles * 3.4 * 1.01);
      await okApi.close();
    });
  });
});
