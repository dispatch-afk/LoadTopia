import { PrismaClient } from "@loadtopia/db";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "../app";
import { loadEnv } from "../config/env";
import { allMockProviders } from "./helpers";

export const TEST_DB_URL = process.env.TEST_DATABASE_URL;
export const SESSION_COOKIE = "loadtopia_session";

/** All application tables, child-first, for TRUNCATE ... CASCADE. */
const TABLES = [
  "load_events",
  "load_offers",
  "loads",
  "market_rates",
  "lanes",
  "equipment",
  "locations",
  "sessions",
  "audit_logs",
  "company_users",
  "users",
  "companies",
];

export function makePrisma(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
}

export async function resetDb(prisma: PrismaClient): Promise<void> {
  // TRUNCATE does not fire the load_events append-only row trigger.
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );
}

export async function makeApp(prisma: PrismaClient): Promise<FastifyInstance> {
  const env = loadEnv({
    NODE_ENV: "test",
    DATABASE_URL: TEST_DB_URL,
    LOG_LEVEL: "silent",
    ARGON_MEMORY_KIB: "8192",
  } as NodeJS.ProcessEnv);
  return buildApp({ env, prisma, providers: allMockProviders() });
}

export interface Session {
  cookie: string;
  userId: string;
  companyId: string;
  email: string;
}

function cookieFrom(res: { cookies: Array<{ name: string; value: string }> }): string {
  const c = res.cookies.find((x) => x.name === SESSION_COOKIE);
  if (!c) throw new Error("no session cookie in response");
  return c.value;
}

let counter = 0;

export async function registerCompany(
  api: FastifyInstance,
  opts: { type?: "SHIPPER" | "CARRIER"; companyName?: string; email?: string } = {},
): Promise<Session> {
  counter += 1;
  const email = opts.email ?? `user${counter}@it.test`;
  const res = await api.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      email,
      password: "integration-test-password",
      firstName: "Test",
      lastName: `User${counter}`,
      companyName: opts.companyName ?? `IT Co ${counter}`,
      companyType: opts.type ?? "SHIPPER",
    },
  });
  if (res.statusCode !== 201) {
    throw new Error(`register failed ${res.statusCode}: ${res.body}`);
  }
  const cookie = cookieFrom(res);
  const body = res.json();
  return { cookie, userId: body.user.id, companyId: body.activeCompanyId, email };
}

export function authed(cookie: string, opts: InjectOptions): InjectOptions {
  return { ...opts, cookies: { ...(opts.cookies ?? {}), [SESSION_COOKIE]: cookie } };
}

/** Register the shipper and return the id of its first location (geocoded via mock). */
export async function createLocation(
  api: FastifyInstance,
  cookie: string,
  over: Partial<Record<string, string>> = {},
): Promise<string> {
  const res = await api.inject(
    authed(cookie, {
      method: "POST",
      url: "/api/locations",
      payload: {
        name: over.name ?? "Warehouse",
        addressLine1: over.addressLine1 ?? "1 Dock St",
        city: over.city ?? "Chicago",
        state: over.state ?? "IL",
        postalCode: over.postalCode ?? "60601",
        country: "US",
      },
    }),
  );
  if (res.statusCode !== 201) throw new Error(`createLocation ${res.statusCode}: ${res.body}`);
  return res.json().id;
}
