import { describe, expect, it } from "vitest";
import { corsOrigins, loadEnv, providerSelection } from "../config/env";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db?schema=public",
} as NodeJS.ProcessEnv;

describe("loadEnv", () => {
  it("applies documented defaults", () => {
    const env = loadEnv(base);
    expect(env.API_PORT).toBe(4000);
    expect(env.SESSION_TTL_HOURS).toBe(168);
    expect(env.ROUTING_PROVIDER).toBe("mock");
    expect(env.NODE_ENV).toBe("development");
  });

  it("throws a descriptive error when DATABASE_URL is missing", () => {
    expect(() => loadEnv({} as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });

  it("rejects a non-URL DATABASE_URL", () => {
    expect(() => loadEnv({ DATABASE_URL: "not-a-url" } as NodeJS.ProcessEnv)).toThrow(
      /Invalid environment/,
    );
  });

  it("requires secure cookies in production", () => {
    expect(() =>
      loadEnv({ ...base, NODE_ENV: "production", SESSION_COOKIE_SECURE: "false" } as NodeJS.ProcessEnv),
    ).toThrow(/SESSION_COOKIE_SECURE/);
  });

  it("coerces booleanish and numeric strings", () => {
    const env = loadEnv({ ...base, SESSION_COOKIE_SECURE: "true", API_PORT: "8080" } as NodeJS.ProcessEnv);
    expect(env.SESSION_COOKIE_SECURE).toBe(true);
    expect(env.API_PORT).toBe(8080);
  });

  it("parses the CORS origin list", () => {
    const env = loadEnv({ ...base, CORS_ORIGINS: "https://a.test, https://b.test" } as NodeJS.ProcessEnv);
    expect(corsOrigins(env)).toEqual(["https://a.test", "https://b.test"]);
  });

  it("exposes a full provider selection", () => {
    expect(Object.keys(providerSelection(loadEnv(base))).sort()).toEqual(
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
  });
});
