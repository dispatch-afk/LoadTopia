/**
 * End-to-end authentication flow against a REAL PostgreSQL database.
 *
 * Requires: TEST_DATABASE_URL pointing at a database with migrations applied
 * (`pnpm --filter @loadtopia/db migrate:deploy`). Run with `pnpm test:integration`.
 * Skipped automatically when TEST_DATABASE_URL is not set.
 */
import { PrismaClient } from "@loadtopia/db";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { allMockProviders } from "./helpers";
import { loadEnv } from "../config/env";

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const suite = TEST_DB_URL ? describe : describe.skip;

suite("auth flow (integration)", () => {
  let prisma: PrismaClient;
  let app: FastifyInstance;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await app?.close();
    // Clean up between tests (order respects FKs).
    await prisma.session.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.user.deleteMany();
    await prisma.company.deleteMany();
  });

  async function makeApp() {
    const env = loadEnv({
      NODE_ENV: "test",
      DATABASE_URL: TEST_DB_URL,
      LOG_LEVEL: "silent",
      ARGON_MEMORY_KIB: "8192",
    } as NodeJS.ProcessEnv);
    app = await buildApp({ env, prisma, providers: allMockProviders() });
    return app;
  }

  const payload = {
    email: "carrier@integration.test",
    password: "integration-test-password",
    firstName: "Ivy",
    lastName: "Ng",
    companyName: "Integration Carriers",
    companyType: "CARRIER" as const,
  };

  it("registers a user, sets a session cookie, and authorizes /me", async () => {
    const api = await makeApp();

    const reg = await api.inject({ method: "POST", url: "/api/auth/register", payload });
    expect(reg.statusCode).toBe(201);
    const cookie = reg.cookies.find((c) => c.name === "loadtopia_session");
    expect(cookie?.value).toBeTruthy();
    expect(cookie?.httpOnly).toBe(true);
    expect(reg.json().permissions).toContain("offer:create");

    const me = await api.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { loadtopia_session: cookie!.value },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe(payload.email);
    expect(me.json().role).toBe("CARRIER");
  });

  it("rejects duplicate registration with 409", async () => {
    const api = await makeApp();
    await api.inject({ method: "POST", url: "/api/auth/register", payload });
    const dup = await api.inject({ method: "POST", url: "/api/auth/register", payload });
    expect(dup.statusCode).toBe(409);
  });

  it("logs in with correct credentials and rejects wrong ones uniformly", async () => {
    const api = await makeApp();
    await api.inject({ method: "POST", url: "/api/auth/register", payload });

    const good = await api.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: payload.email, password: payload.password },
    });
    expect(good.statusCode).toBe(200);

    const bad = await api.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: payload.email, password: "wrong-password" },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.message).toBe("Invalid email or password");
  });

  it("revokes the session on logout", async () => {
    const api = await makeApp();
    const reg = await api.inject({ method: "POST", url: "/api/auth/register", payload });
    const value = reg.cookies.find((c) => c.name === "loadtopia_session")!.value;

    await api.inject({
      method: "POST",
      url: "/api/auth/logout",
      cookies: { loadtopia_session: value },
    });

    const me = await api.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { loadtopia_session: value },
    });
    expect(me.statusCode).toBe(401);
  });
});
