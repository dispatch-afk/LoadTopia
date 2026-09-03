import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

/**
 * Process-wide PrismaClient singleton, created LAZILY.
 *
 * Importing this module must not construct a client or load the native query
 * engine — tests inject their own client and never touch the real one, and the
 * API creates its client explicitly in the Prisma plugin. The `prisma` export
 * below is a Proxy that instantiates on first property access.
 */
const globalForPrisma = globalThis as unknown as { __loadtopiaPrisma?: PrismaClient };

export function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export function getPrisma(): PrismaClient {
  if (!globalForPrisma.__loadtopiaPrisma) {
    globalForPrisma.__loadtopiaPrisma = createPrismaClient();
  }
  return globalForPrisma.__loadtopiaPrisma;
}

/** Lazy singleton. Safe to import anywhere; engine loads only on real use. */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getPrisma(), prop, receiver);
  },
});

export interface DatabaseHealth {
  ok: boolean;
  latencyMs: number | null;
  message?: string;
}

/** Lightweight connectivity probe used by GET /api/health. */
export async function checkDatabaseHealth(client: {
  $queryRawUnsafe: (q: string) => Promise<unknown>;
}): Promise<DatabaseHealth> {
  const start = performance.now();
  try {
    await client.$queryRawUnsafe("SELECT 1");
    return { ok: true, latencyMs: Math.round((performance.now() - start) * 100) / 100 };
  } catch (err) {
    return { ok: false, latencyMs: null, message: (err as Error).message };
  }
}
