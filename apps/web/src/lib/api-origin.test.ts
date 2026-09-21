import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertValidProductionApiOrigin, resolveApiOrigin } from "./api-origin.mjs";

describe("resolveApiOrigin — Milestone 4 release correction (P1-4)", () => {
  it("development: a missing API_ORIGIN falls back to the local API dev server", () => {
    expect(resolveApiOrigin({ NODE_ENV: "development" })).toBe("http://localhost:4000");
  });

  it("development: an explicitly-set API_ORIGIN (even a non-HTTPS one) is used as-is", () => {
    expect(resolveApiOrigin({ NODE_ENV: "development", API_ORIGIN: "http://localhost:5000" })).toBe(
      "http://localhost:5000",
    );
  });

  it("test: a missing API_ORIGIN falls back to the local API dev server", () => {
    expect(resolveApiOrigin({ NODE_ENV: "test" })).toBe("http://localhost:4000");
  });

  it("production: a valid https:// origin is accepted, with any trailing slash removed", () => {
    expect(
      resolveApiOrigin({ NODE_ENV: "production", API_ORIGIN: "https://api.example.com/" }),
    ).toBe("https://api.example.com");
  });

  it("production: a missing API_ORIGIN is rejected — never silently falls back to localhost", () => {
    expect(() => resolveApiOrigin({ NODE_ENV: "production" })).toThrow(/required in production/i);
  });

  it("production: an empty/blank API_ORIGIN is rejected", () => {
    expect(() => resolveApiOrigin({ NODE_ENV: "production", API_ORIGIN: "   " })).toThrow(
      /required in production/i,
    );
  });

  it("production: a malformed API_ORIGIN is rejected", () => {
    expect(() =>
      resolveApiOrigin({ NODE_ENV: "production", API_ORIGIN: "not-a-url" }),
    ).toThrow(/not a valid absolute url/i);
  });

  it("production: a plain http:// origin is rejected — HTTPS is required", () => {
    expect(() =>
      resolveApiOrigin({ NODE_ENV: "production", API_ORIGIN: "http://api.example.com" }),
    ).toThrow(/must use https/i);
  });

  it("production: an origin carrying a path/query/fragment is rejected", () => {
    expect(() =>
      resolveApiOrigin({ NODE_ENV: "production", API_ORIGIN: "https://api.example.com/v1" }),
    ).toThrow(/bare origin/i);
    expect(() =>
      resolveApiOrigin({ NODE_ENV: "production", API_ORIGIN: "https://api.example.com?x=1" }),
    ).toThrow(/bare origin/i);
  });
});

describe("assertValidProductionApiOrigin", () => {
  it("returns the normalized origin for a valid value", () => {
    expect(assertValidProductionApiOrigin("https://api.example.com")).toBe(
      "https://api.example.com",
    );
  });

  it("throws for undefined", () => {
    expect(() => assertValidProductionApiOrigin(undefined)).toThrow();
  });
});

// Milestone 4 release correction (P1-4 residual fix): `getApiOrigin()` reads
// `process.env` directly (it has no `env` parameter — every real call site,
// `apiServer()` and the `/api/*` Route Handler proxy, calls it with none)
// and memoizes across calls, so these tests manipulate `process.env` via
// `vi.stubEnv` and isolate the module's cache per test with
// `vi.resetModules()` + a dynamic import.
describe("getApiOrigin — memoized runtime resolution shared by apiServer() and the proxy", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves using process.env on first call", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("API_ORIGIN", "http://localhost:5000");
    const { getApiOrigin } = await import("./api-origin.mjs");
    expect(getApiOrigin()).toBe("http://localhost:5000");
  });

  it("memoizes: a later env change has no effect on subsequent calls", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("API_ORIGIN", "http://localhost:5000");
    const { getApiOrigin } = await import("./api-origin.mjs");
    expect(getApiOrigin()).toBe("http://localhost:5000");

    vi.stubEnv("API_ORIGIN", "http://localhost:9999");
    expect(getApiOrigin()).toBe("http://localhost:5000");
  });

  it("production: throws the same clear error resolveApiOrigin would for a missing API_ORIGIN", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("API_ORIGIN", "");
    const { getApiOrigin } = await import("./api-origin.mjs");
    expect(() => getApiOrigin()).toThrow(/required in production/i);
  });

  it("a failed resolution is never cached as a poisoned value — a later call with a valid origin still succeeds", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("API_ORIGIN", "");
    const { getApiOrigin } = await import("./api-origin.mjs");
    expect(() => getApiOrigin()).toThrow(/required in production/i);

    vi.stubEnv("API_ORIGIN", "https://api.example.com");
    expect(getApiOrigin()).toBe("https://api.example.com");
  });
});
