import { checkDatabaseHealth } from "@loadtopia/db";
import { collectProviderHealth } from "@loadtopia/providers";
import type { HealthReport, HealthStatus } from "@loadtopia/shared";
import type { FastifyInstance } from "fastify";

const startedAt = Date.now();
const VERSION = process.env.npm_package_version ?? "0.0.0";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  /** Liveness: process is up. No dependency checks. Never rate-limited. */
  app.get("/health/live", { config: { rateLimit: false } }, async () => ({
    status: "ok" as const,
    service: "loadtopia-api",
    timestamp: new Date().toISOString(),
  }));

  /** Readiness: can this instance serve traffic (DB reachable)? */
  app.get("/health/ready", { config: { rateLimit: false } }, async (_req, reply) => {
    const db = await checkDatabaseHealth(app.prisma);
    reply.status(db.ok ? 200 : 503);
    return { status: db.ok ? "ok" : "error", database: db };
  });

  /** Full health report: DB + every configured provider. */
  app.get("/health", { config: { rateLimit: false } }, async (_req, reply): Promise<HealthReport> => {
    const db = await checkDatabaseHealth(app.prisma);
    const providers = await collectProviderHealth(app.providers);

    const providerStatuses = Object.values(providers).map((p) => p.status as HealthStatus);
    let status: HealthStatus = "ok";
    if (!db.ok || providerStatuses.includes("error")) status = "error";
    else if (providerStatuses.includes("degraded")) status = "degraded";

    reply.status(status === "ok" ? 200 : 503);
    return {
      status,
      service: "loadtopia-api",
      version: VERSION,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      checks: {
        database: {
          status: db.ok ? "ok" : "error",
          latencyMs: db.latencyMs,
          message: db.message,
        },
        providers: providers as HealthReport["checks"]["providers"],
      },
    };
  });
}
