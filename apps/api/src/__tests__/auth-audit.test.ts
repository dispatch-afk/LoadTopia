import type { FastifyInstance } from "fastify";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { hashPassword } from "../lib/password";
import { allMockProviders, fakePrisma, testEnv } from "./helpers";

/**
 * Failed-login auditing. These run with a fake Prisma so they need no database;
 * the DB-backed equivalents live in auth.integration.test.ts.
 */

const CORRECT_PASSWORD = "the-actual-correct-password";
let correctHash: string;

beforeAll(async () => {
  correctHash = await hashPassword(CORRECT_PASSWORD, {
    memoryKiB: 8192,
    timeCost: 2,
    parallelism: 1,
  });
});

let app: FastifyInstance | undefined;
const auditWrites: Array<Record<string, unknown>> = [];

afterEach(async () => {
  await app?.close();
  app = undefined;
  auditWrites.length = 0;
});

function appWithUser(user: unknown) {
  return buildApp({
    env: testEnv(),
    providers: allMockProviders(),
    prisma: fakePrisma({
      user: { findUnique: async () => user },
      auditLog: {
        create: async (args: { data: Record<string, unknown> }) => {
          auditWrites.push(args.data);
          return args.data;
        },
      },
    }),
  });
}

const UNIFORM_401 = { code: "UNAUTHORIZED", message: "Invalid email or password" };

describe("failed-login auditing", () => {
  it("writes an audit record for an invalid password and keeps the uniform 401", async () => {
    app = await appWithUser({
      id: "user-1",
      email: "known@shipper.test",
      passwordHash: correctHash,
      isActive: true,
      memberships: [],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "known@shipper.test", password: "wrong-password" },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatchObject(UNIFORM_401);

    expect(auditWrites).toHaveLength(1);
    const row = auditWrites[0]!;
    expect(row).toMatchObject({
      actorUserId: null,
      action: "auth.login_failed",
      entityType: "user",
      entityId: null,
    });
    expect(row.data).toMatchObject({ reason: "invalid_credentials", email: "known@shipper.test" });
    expect((row.data as { requestId?: string }).requestId).toBeTruthy();
  });

  it("writes an audit record for an unknown email and keeps the uniform 401", async () => {
    app = await appWithUser(null);

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "nobody@nowhere.test", password: "whatever-password" },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatchObject(UNIFORM_401);

    expect(auditWrites).toHaveLength(1);
    expect(auditWrites[0]).toMatchObject({
      actorUserId: null,
      action: "auth.login_failed",
      entityType: "user",
      entityId: null,
      data: { reason: "invalid_credentials", email: "nobody@nowhere.test" },
    });
  });

  it("produces an audit record of identical shape whether or not the email exists", async () => {
    app = await appWithUser({
      id: "user-1",
      email: "known@shipper.test",
      passwordHash: correctHash,
      isActive: true,
      memberships: [],
    });
    await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "known@shipper.test", password: "wrong" },
    });
    const knownRow = auditWrites[0]!;
    await app.close();
    auditWrites.length = 0;

    app = await appWithUser(null);
    await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "unknown@shipper.test", password: "wrong" },
    });
    const unknownRow = auditWrites[0]!;

    // Same keys, same action, same reason — the only difference is the
    // attempted email the caller themselves supplied.
    expect(Object.keys(knownRow).sort()).toEqual(Object.keys(unknownRow).sort());
    expect(knownRow.action).toBe(unknownRow.action);
    expect((knownRow.data as { reason: string }).reason).toBe(
      (unknownRow.data as { reason: string }).reason,
    );
    expect(knownRow.actorUserId).toBe(unknownRow.actorUserId);
    expect(knownRow.entityId).toBe(unknownRow.entityId);
  });

  it("never writes a password, hash, or token into the audit record", async () => {
    app = await appWithUser({
      id: "user-1",
      email: "known@shipper.test",
      passwordHash: correctHash,
      isActive: true,
      memberships: [],
    });

    await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "known@shipper.test", password: "SuperSecret-wrong-123" },
    });

    const serialized = JSON.stringify(auditWrites[0]);
    expect(serialized).not.toContain("SuperSecret-wrong-123");
    expect(serialized).not.toContain(correctHash);
    expect(serialized).not.toContain("$argon2");
    expect(serialized.toLowerCase()).not.toContain("passwordhash");
    expect(serialized).not.toContain("token");
  });

  it("does not audit a validation failure (no reason category, no DB write)", async () => {
    app = await appWithUser(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "not-an-email", password: "x" },
    });
    expect(res.statusCode).toBe(400);
    expect(auditWrites).toHaveLength(0);
  });
});
