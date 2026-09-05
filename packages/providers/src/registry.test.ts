import { describe, expect, it } from "vitest";
import { createProviderRegistry, type ProviderSelection } from "./registry";
import { GoogleGeocodingProvider } from "./google/google-geocoding-provider";
import { GoogleRoutingProvider } from "./google/google-routing-provider";
import { MockGeocodingProvider, MockStorageProvider } from "./mock/mock-misc-providers";
import { MockRoutingProvider } from "./mock/mock-routing-provider";
import { S3StorageProvider } from "./s3/s3-storage-provider";

const S3_CONFIG = {
  region: "us-east-1",
  bucket: "loadtopia-docs",
  accessKeyId: "AKIA_TEST",
  secretAccessKey: "secret_test",
};

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

describe("createProviderRegistry — S3 storage configuration", () => {
  it("defaults storage to the (non-functional) mock provider", () => {
    const reg = createProviderRegistry(ALL_MOCK);
    expect(reg.storage).toBeInstanceOf(MockStorageProvider);
    expect(reg.storage.isMock).toBe(true);
  });

  it("selecting s3 with a complete config constructs the real adapter", () => {
    const reg = createProviderRegistry({ ...ALL_MOCK, storage: "s3" }, {}, S3_CONFIG);
    expect(reg.storage).toBeInstanceOf(S3StorageProvider);
    expect(reg.storage.isMock).toBe(false);
    expect(reg.storage.name).toBe("s3");
  });

  it("selecting s3 with NO config fails at boot — never falls back to mock", () => {
    let reg: ReturnType<typeof createProviderRegistry> | undefined;
    let threw = false;
    try {
      reg = createProviderRegistry({ ...ALL_MOCK, storage: "s3" });
    } catch (err) {
      threw = true;
      expect((err as Error).message).toMatch(/STORAGE_S3_/);
    }
    expect(threw).toBe(true);
    expect(reg).toBeUndefined();
  });

  it("selecting s3 with partial config fails at boot", () => {
    expect(() =>
      createProviderRegistry({ ...ALL_MOCK, storage: "s3" }, {}, { region: "us-east-1", bucket: "b" }),
    ).toThrow(/STORAGE_S3_ACCESS_KEY_ID, STORAGE_S3_SECRET_ACCESS_KEY/);
  });

  it("an unknown storage provider name fails at boot, same as every other provider", () => {
    expect(() => createProviderRegistry({ ...ALL_MOCK, storage: "dropbox" })).toThrow(/Unknown storage/);
  });
});
