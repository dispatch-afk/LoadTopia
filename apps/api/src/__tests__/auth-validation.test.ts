import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { allMockProviders, fakePrisma, testEnv } from "./helpers";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function makeApp() {
  return buildApp({
    env: testEnv(),
    // Reject any DB read so we prove validation runs *before* persistence.
    prisma: fakePrisma({
      user: {
        findUnique: async () => {
          throw new Error("db must not be reached on invalid input");
        },
      },
    }),
    providers: allMockProviders(),
  });
}

describe("POST /api/auth/register — input validation", () => {
  it("rejects a malformed email with 400 VALIDATION_ERROR", async () => {
    app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "nope",
        password: "a-long-enough-password",
        firstName: "A",
        lastName: "B",
        companyName: "Acme",
        companyType: "SHIPPER",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a short password", async () => {
    app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "user@acme.test",
        password: "short",
        firstName: "A",
        lastName: "B",
        companyName: "Acme",
        companyType: "SHIPPER",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an unknown companyType", async () => {
    app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "user@acme.test",
        password: "a-long-enough-password",
        firstName: "A",
        lastName: "B",
        companyName: "Acme",
        companyType: "BROKER",
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("auth guards", () => {
  it("GET /api/auth/me returns 401 without a session cookie", async () => {
    app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("unknown routes return a structured 404", async () => {
    app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/does-not-exist" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.requestId).toBeTruthy();
  });
});
