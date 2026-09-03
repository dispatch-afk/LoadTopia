import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { allMockProviders, fakePrisma, testEnv } from "./helpers";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("GET /api/health/live", () => {
  it("always reports ok without touching dependencies", async () => {
    app = await buildApp({
      env: testEnv(),
      prisma: fakePrisma({
        $queryRawUnsafe: async () => {
          throw new Error("db should not be called for liveness");
        },
      }),
      providers: allMockProviders(),
    });
    const res = await app.inject({ method: "GET", url: "/api/health/live" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", service: "loadtopia-api" });
  });
});

describe("GET /api/health", () => {
  it("returns 200 and status ok when the database and providers are healthy", async () => {
    app = await buildApp({
      env: testEnv(),
      prisma: fakePrisma(),
      providers: allMockProviders(),
    });
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.checks.database.status).toBe("ok");
    expect(body.checks.providers.pricing).toMatchObject({ isMock: true, status: "ok" });
    expect(body.checks.providers.carrierVerification).toMatchObject({ isMock: true, status: "ok" });
    expect(Object.keys(body.checks.providers)).toHaveLength(8);
  });

  it("returns 503 and status error when the database is unreachable", async () => {
    app = await buildApp({
      env: testEnv(),
      prisma: fakePrisma({
        $queryRawUnsafe: async () => {
          throw new Error("connection refused");
        },
      }),
      providers: allMockProviders(),
    });
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(503);
    expect(res.json().status).toBe("error");
  });

  it("attaches an x-request-id response header", async () => {
    app = await buildApp({ env: testEnv(), prisma: fakePrisma(), providers: allMockProviders() });
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.headers["x-request-id"]).toBeTruthy();
  });
});
