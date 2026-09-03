import type { PrismaClient } from "@loadtopia/db";
import type { ProviderRegistry } from "@loadtopia/providers";
import Fastify, { type FastifyInstance } from "fastify";
import { type Env, loadEnv } from "./config/env";
import { registerErrorHandler } from "./lib/errors";
import { authPlugin } from "./plugins/auth";
import { prismaPlugin } from "./plugins/prisma";
import { providersPlugin } from "./plugins/providers";
import { requestContextPlugin } from "./plugins/request-context";
import { securityPlugin } from "./plugins/security";
import { authRoutes } from "./modules/auth/auth.routes";
import { healthRoutes } from "./modules/health/health.routes";

export interface BuildAppOptions {
  env?: Env;
  /** Inject a Prisma client (tests / custom lifecycle). */
  prisma?: PrismaClient;
  /** Inject a provider registry (tests). */
  providers?: ProviderRegistry;
}

/**
 * Constructs a fully-wired Fastify instance WITHOUT starting a listener.
 * Used by `src/index.ts` for the real server and by the test suite via
 * `app.inject()`.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = options.env ?? loadEnv();

  const app = Fastify({
    trustProxy: true,
    logger: {
      level: env.LOG_LEVEL,
      redact: ["req.headers.cookie", "req.headers.authorization"],
      transport:
        env.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { translateTime: "SYS:standard", ignore: "pid,hostname" } }
          : undefined,
    },
  });

  app.decorate("env", env);

  await app.register(requestContextPlugin);
  await app.register(prismaPlugin, { client: options.prisma });
  await app.register(providersPlugin, { registry: options.providers });
  await app.register(securityPlugin);
  await app.register(authPlugin);

  registerErrorHandler(app);

  // All business routes are namespaced under /api.
  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(authRoutes);
    },
    { prefix: "/api" },
  );

  return app;
}
