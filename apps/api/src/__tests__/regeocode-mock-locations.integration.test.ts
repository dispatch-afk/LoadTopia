import type { PrismaClient } from "@loadtopia/db";
import type { GeocodingProvider, PostalAddress } from "@loadtopia/providers";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runRemediation } from "../../scripts/regeocode-mock-locations";
import { authed, createLocation, makeApp, makePrisma, registerCompany, resetDb, TEST_DB_URL } from "./it-harness";

const suite = TEST_DB_URL ? describe : describe.skip;

const NEW_LAT = 40.123456;
const NEW_LNG = -100.654321;

/** A fake, deterministic stand-in for GoogleGeocodingProvider — no real network
 *  call. Tracks every address it was asked to geocode, and can be told to fail
 *  for specific cities to exercise the per-row failure path. */
function fakeGeocoder(opts: { failForCities?: Set<string> } = {}): GeocodingProvider & {
  calls: PostalAddress[];
} {
  const calls: PostalAddress[] = [];
  return {
    name: "google",
    isMock: false,
    calls,
    async geocode(address) {
      calls.push(address);
      if (opts.failForCities?.has(address.city)) {
        throw new Error(`simulated geocoding failure for ${address.city}`);
      }
      return {
        point: { latitude: NEW_LAT, longitude: NEW_LNG },
        normalizedAddress: { ...address, country: address.country || "US" },
        provider: "google",
        isMock: false,
        retrievedAt: new Date().toISOString(),
        metadata: { placeId: `TEST_PLACE_${address.city.replace(/\s+/g, "_")}` },
      };
    },
    async health() {
      return { status: "ok" as const, isMock: false };
    },
  };
}

const silentLog = { info: () => {}, warn: () => {} };

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

suite("regeocode-mock-locations script (integration)", () => {
  let prisma: PrismaClient;
  let api: FastifyInstance;

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
    api = await makeApp(prisma); // all-mock registry — createLocation() geocodes via MockGeocodingProvider
  });

  /** A fresh company + one Location geocoded via the app's (mock) GeocodingProvider. */
  async function mockGeocodedLocation(overrides: { name: string; city: string; state: string }) {
    const s = await registerCompany(api, { companyName: `Remediation Co ${overrides.city}` });
    const id = await createLocation(api, s.cookie, overrides);
    return { session: s, id };
  }

  it("A. dry-run selects only isActive=true + geocodedBy='mock', calls Google zero times, writes zero rows", async () => {
    const target = await mockGeocodedLocation({ name: "Target", city: "Woodbridge", state: "VA" });

    // Inactive mock location — must NOT be matched.
    const inactive = await mockGeocodedLocation({ name: "Inactive", city: "Nowhere", state: "TX" });
    await prisma.location.update({ where: { id: inactive.id }, data: { isActive: false } });

    // Already-remediated location — must NOT be matched.
    const alreadyDone = await mockGeocodedLocation({ name: "AlreadyGoogle", city: "Austin", state: "TX" });
    await prisma.location.update({ where: { id: alreadyDone.id }, data: { geocodedBy: "google" } });

    void target;
    const before = await prisma.location.findMany({ orderBy: { id: "asc" } });
    const geocoder = fakeGeocoder();
    const result = await runRemediation(prisma, geocoder, { execute: false }, silentLog);

    expect(result.dryRun).toBe(true);
    expect(result.matched).toBe(1); // only "Target"
    expect(result.attempted).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.failed).toBe(0);
    expect(geocoder.calls).toHaveLength(0); // never calls Google in dry-run

    const after = await prisma.location.findMany({ orderBy: { id: "asc" } });
    expect(after).toEqual(before); // F: zero writes with no --execute
  });

  it("B. execute updates only lat/lng/providerPlaceId/geocodedBy on the targeted location; everything else is unchanged", async () => {
    const target = await mockGeocodedLocation({ name: "Keep My Name", city: "Woodbridge", state: "VA" });
    const before = await prisma.location.findUniqueOrThrow({ where: { id: target.id } });
    expect(before.geocodedBy).toBe("mock");

    const geocoder = fakeGeocoder();
    const result = await runRemediation(prisma, geocoder, { execute: true }, silentLog);

    expect(result.dryRun).toBe(false);
    expect(result.matched).toBe(1);
    expect(result.attempted).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.failed).toBe(0);

    const after = await prisma.location.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.latitude?.toNumber()).toBeCloseTo(NEW_LAT, 6);
    expect(after.longitude?.toNumber()).toBeCloseTo(NEW_LNG, 6);
    expect(after.providerPlaceId).toBe("TEST_PLACE_Woodbridge");
    expect(after.geocodedBy).toBe("google");

    // Everything else byte-for-byte unchanged.
    expect(after.name).toBe(before.name);
    expect(after.addressLine1).toBe(before.addressLine1);
    expect(after.addressLine2).toBe(before.addressLine2);
    expect(after.city).toBe(before.city);
    expect(after.state).toBe(before.state);
    expect(after.postalCode).toBe(before.postalCode);
    expect(after.country).toBe(before.country);
    expect(after.isActive).toBe(before.isActive);
    expect(after.companyId).toBe(before.companyId);
    expect(after.createdAt).toEqual(before.createdAt);
  });

  it("C. does not modify loads or pricing_snapshots referencing the remediated location", async () => {
    const s = await registerCompany(api, { companyName: "Isolation Co" });
    const origin = await createLocation(api, s.cookie, { name: "Origin", city: "Woodbridge", state: "VA" });
    const dest = await createLocation(api, s.cookie, { name: "Dest", city: "Beverly Hills", state: "CA" });
    const created = await api.inject(
      authed(s.cookie, { method: "POST", url: "/api/loads", payload: draftPayload(origin, dest) }),
    );
    const loadId = created.json().id;
    const posted = await api.inject(authed(s.cookie, { method: "POST", url: `/api/loads/${loadId}/post` }));
    expect(posted.statusCode).toBe(200);

    const loadBefore = await prisma.load.findUniqueOrThrow({ where: { id: loadId } });
    const snapshotsBefore = await prisma.pricingSnapshot.findMany({
      where: { loadId },
      orderBy: { id: "asc" },
    });
    expect(snapshotsBefore.length).toBeGreaterThan(0);

    const geocoder = fakeGeocoder();
    const result = await runRemediation(prisma, geocoder, { execute: true }, silentLog);
    expect(result.updated).toBeGreaterThan(0); // the origin/destination were actually remediated

    const loadAfter = await prisma.load.findUniqueOrThrow({ where: { id: loadId } });
    const snapshotsAfter = await prisma.pricingSnapshot.findMany({
      where: { loadId },
      orderBy: { id: "asc" },
    });
    expect(loadAfter).toEqual(loadBefore);
    expect(snapshotsAfter).toEqual(snapshotsBefore);
  });

  it("D. a geocoding failure for one location leaves it unchanged while other locations still complete", async () => {
    const ok = await mockGeocodedLocation({ name: "OK", city: "Austin", state: "TX" });
    const bad = await mockGeocodedLocation({ name: "Bad", city: "Deerfield Beach", state: "FL" });
    const beforeBad = await prisma.location.findUniqueOrThrow({ where: { id: bad.id } });

    const geocoder = fakeGeocoder({ failForCities: new Set(["Deerfield Beach"]) });
    const result = await runRemediation(prisma, geocoder, { execute: true }, silentLog);

    expect(result.matched).toBe(2);
    expect(result.attempted).toBe(2);
    expect(result.updated).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.failedLocationIds).toEqual([bad.id]);

    const afterOk = await prisma.location.findUniqueOrThrow({ where: { id: ok.id } });
    expect(afterOk.geocodedBy).toBe("google");

    const afterBad = await prisma.location.findUniqueOrThrow({ where: { id: bad.id } });
    expect(afterBad).toEqual(beforeBad); // byte-for-byte unchanged — failure never partially writes
  });

  it("E. running again after a successful remediation matches zero rows and performs zero writes", async () => {
    await mockGeocodedLocation({ name: "Once", city: "Beverly Hills", state: "CA" });

    const first = await runRemediation(prisma, fakeGeocoder(), { execute: true }, silentLog);
    expect(first.updated).toBe(1);

    const afterFirst = await prisma.location.findMany({ orderBy: { id: "asc" } });
    const geocoder2 = fakeGeocoder();
    const second = await runRemediation(prisma, geocoder2, { execute: true }, silentLog);

    expect(second.matched).toBe(0);
    expect(second.attempted).toBe(0);
    expect(second.updated).toBe(0);
    expect(geocoder2.calls).toHaveLength(0);

    const afterSecond = await prisma.location.findMany({ orderBy: { id: "asc" } });
    expect(afterSecond).toEqual(afterFirst);
  });
});
