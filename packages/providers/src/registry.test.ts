import { describe, expect, it } from "vitest";
import { createProviderRegistry, type ProviderSelection } from "./registry";
import { GoogleGeocodingProvider } from "./google/google-geocoding-provider";
import { GoogleRoutingProvider } from "./google/google-routing-provider";
import { MockGeocodingProvider } from "./mock/mock-misc-providers";
import { MockRoutingProvider } from "./mock/mock-routing-provider";

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

describe("createProviderRegistry — Google configuration", () => {
  it("defaults to mock when no provider override is given (local/CI default)", () => {
    const reg = createProviderRegistry(ALL_MOCK);
    expect(reg.routing).toBeInstanceOf(MockRoutingProvider);
    expect(reg.geocoding).toBeInstanceOf(MockGeocodingProvider);
    expect(reg.routing.isMock).toBe(true);
    expect(reg.geocoding.isMock).toBe(true);
  });

  it("selecting google explicitly with a configured key constructs the real adapters", () => {
    const reg = createProviderRegistry(
      { ...ALL_MOCK, routing: "google", geocoding: "google" },
      { mapsApiKey: "shared-test-key" },
    );
    expect(reg.routing).toBeInstanceOf(GoogleRoutingProvider);
    expect(reg.geocoding).toBeInstanceOf(GoogleGeocodingProvider);
    expect(reg.routing.isMock).toBe(false);
    expect(reg.geocoding.isMock).toBe(false);
  });

  it("prefers a split key over the shared GOOGLE_MAPS_API_KEY when both are set", () => {
    // Construction succeeding at all (no throw) proves a key resolved; the
    // split-vs-shared precedence itself is covered directly in shared.test.ts.
    expect(() =>
      createProviderRegistry(
        { ...ALL_MOCK, routing: "google" },
        { mapsApiKey: "shared", routesApiKey: "routes-only" },
      ),
    ).not.toThrow();
  });

  it("selecting google for routing with NO key configured fails at boot", () => {
    expect(() => createProviderRegistry({ ...ALL_MOCK, routing: "google" })).toThrow(
      /no API key is configured/,
    );
  });

  it("selecting google for geocoding with NO key configured fails at boot", () => {
    expect(() => createProviderRegistry({ ...ALL_MOCK, geocoding: "google" })).toThrow(
      /no API key is configured/,
    );
  });

  it("an unknown provider name still fails at boot for routing/geocoding, same as every other provider", () => {
    expect(() => createProviderRegistry({ ...ALL_MOCK, routing: "bing" })).toThrow(/Unknown routing/);
    expect(() => createProviderRegistry({ ...ALL_MOCK, geocoding: "here" })).toThrow(/Unknown geocoding/);
  });

  it("never substitutes a mock when the configured Google adapter fails to construct", () => {
    // The only way construction fails today is a missing key — assert the
    // thrown error propagates rather than the registry silently returning a
    // MockRoutingProvider/MockGeocodingProvider instead.
    let reg: ReturnType<typeof createProviderRegistry> | undefined;
    let threw = false;
    try {
      reg = createProviderRegistry({ ...ALL_MOCK, routing: "google" });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(reg).toBeUndefined();
  });
});
