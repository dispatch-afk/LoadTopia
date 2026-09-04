import { describe, expect, it } from "vitest";
import { createProviderRegistry, type ProviderSelection } from "../registry";
import { MockCarrierVerificationProvider } from "./mock-carrier-verification-provider";
import { MockPricingProvider } from "./mock-pricing-provider";
import { MockRoutingProvider } from "./mock-routing-provider";

const ALL_MOCK: ProviderSelection = {
  routing: "mock",
  pricing: "mock",
  geocoding: "mock",
  carrierVerification: "mock",
  payment: "mock",
  storage: "mock",
  notification: "mock",
  tracking: "mock",
};

describe("MockRoutingProvider", () => {
  it("returns a positive, deterministic road distance flagged as mock", async () => {
    const p = new MockRoutingProvider();
    const req = {
      origin: { latitude: 41.88, longitude: -87.63 }, // Chicago
      destination: { latitude: 39.1, longitude: -84.51 }, // Cincinnati
    };
    const a = await p.getRoute(req);
    const b = await p.getRoute(req);
    expect(a.distanceMeters).toBeGreaterThan(0);
    expect(a.durationSeconds).toBeGreaterThan(0);
    expect(a.isMock).toBe(true);
    expect(a.provider).toBe("mock");
    expect(a.distanceMeters).toBe(b.distanceMeters);
  });
});

describe("MockPricingProvider", () => {
  it("returns an ordered rate band with a non-null disclaimer", async () => {
    const p = new MockPricingProvider();
    const est = await p.estimate({
      originRegion: "IL",
      destinationRegion: "OH",
      equipmentType: "DRY_VAN",
      distanceMeters: 480_000,
    });
    expect(est.isMock).toBe(true);
    expect(est.disclaimer).toBeTruthy();
    expect(Number(est.lowRate)).toBeLessThanOrEqual(Number(est.midRate));
    expect(Number(est.midRate)).toBeLessThanOrEqual(Number(est.highRate));
  });
});

describe("MockCarrierVerificationProvider", () => {
  it("returns a deterministic verdict flagged as mock with a NOT-government disclaimer", async () => {
    const p = new MockCarrierVerificationProvider();
    const req = { legalName: "Blue Ridge Carriers", mcNumber: "MC-123456", dotNumber: "1234567" };
    const a = await p.verify(req);
    const b = await p.verify(req);
    expect(a.isMock).toBe(true);
    expect(a.provider).toBe("mock");
    expect(a.disclaimer).toMatch(/NOT FMCSA/i);
    expect(a.status).toBe(b.status);
    expect(["verified", "failed"]).toContain(a.status);
  });

  it("is not_found for a carrier with neither MC nor DOT number", async () => {
    const r = await new MockCarrierVerificationProvider().verify({ legalName: "Nameless LLC" });
    expect(r.status).toBe("not_found");
    expect(r.authorityStatus).toBe("unknown");
  });
});

describe("createProviderRegistry", () => {
  it("wires every provider when all selections are 'mock'", async () => {
    const reg = createProviderRegistry(ALL_MOCK);
    expect(Object.keys(reg).sort()).toEqual(
      [
        "carrierVerification",
        "geocoding",
        "notification",
        "payment",
        "pricing",
        "routing",
        "storage",
        "tracking",
      ].sort(),
    );
    for (const provider of Object.values(reg)) {
      expect(provider.isMock).toBe(true);
      const h = await provider.health();
      expect(h.status).toBe("ok");
    }
  });

  it("throws on an unimplemented provider rather than falling back", () => {
    expect(() => createProviderRegistry({ ...ALL_MOCK, pricing: "dat" })).toThrow(/Unknown pricing/);
  });
});
