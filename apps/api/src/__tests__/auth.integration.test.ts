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

  describe("failed-login auditing", () => {
    async function latestFailedLoginAudit() {
      return prisma.auditLog.findFirst({
        where: { action: "auth.login_failed" },
        orderBy: { createdAt: "desc" },
      });
    }

    it("records an audit row for an invalid password and keeps the uniform 401", async () => {
      const api = await makeApp();
      await api.inject({ method: "POST", url: "/api/auth/register", payload });

      const res = await api.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: payload.email, password: "definitely-not-it" },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toMatchObject({
        code: "UNAUTHORIZED",
        message: "Invalid email or password",
      });

      const row = await latestFailedLoginAudit();
      expect(row).not.toBeNull();
      expect(row!.actorUserId).toBeNull();
      expect(row!.entityType).toBe("user");
      expect(row!.entityId).toBeNull();
      expect(row!.ip).toBeTruthy();
      expect(row!.data).toMatchObject({
        reason: "invalid_credentials",
        email: payload.email,
      });
    });

    it("records an audit row for an unknown email and keeps the uniform 401", async () => {
      const api = await makeApp();

      const res = await api.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "ghost@integration.test", password: "some-password" },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.message).toBe("Invalid email or password");

      const row = await latestFailedLoginAudit();
      expect(row).not.toBeNull();
      expect(row!.actorUserId).toBeNull();
      expect(row!.entityId).toBeNull();
      expect(row!.data).toMatchObject({
        reason: "invalid_credentials",
        email: "ghost@integration.test",
      });
    });

    it("stores no password, hash, or session token in the audit row", async () => {
      const api = await makeApp();
      await api.inject({ method: "POST", url: "/api/auth/register", payload });

      await api.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: payload.email, password: "Leak-Check-Secret-999" },
      });

      const user = await prisma.user.findUniqueOrThrow({ where: { email: payload.email } });
      const rows = await prisma.auditLog.findMany({ where: { action: "auth.login_failed" } });
      const blob = JSON.stringify(rows);
      expect(blob).not.toContain("Leak-Check-Secret-999");
      expect(blob).not.toContain(user.passwordHash);
      expect(blob).not.toContain("$argon2");
      expect(blob.toLowerCase()).not.toContain("passwordhash");
      expect(blob).not.toContain("token");

      // A successful login still audits as "auth.login" (unchanged behaviour).
      const ok = await api.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: payload.email, password: payload.password },
      });
      expect(ok.statusCode).toBe(200);
      expect(await prisma.auditLog.count({ where: { action: "auth.login" } })).toBe(1);
    });
  });
});
