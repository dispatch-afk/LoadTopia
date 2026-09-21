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
import { adminMarketplaceRoutes } from "./modules/admin/admin-marketplace.routes";
import { authRoutes } from "./modules/auth/auth.routes";
import { carrierProfileRoutes } from "./modules/carrier/carrier-profile.routes";
import { checkInsRoutes } from "./modules/check-ins/check-ins.routes";
import { companiesRoutes } from "./modules/companies/companies.routes";
import { dashboardRoutes } from "./modules/dashboard/dashboard.routes";
import { documentsRoutes } from "./modules/documents/documents.routes";
import { equipmentRoutes } from "./modules/equipment/equipment.routes";
import { healthRoutes } from "./modules/health/health.routes";
import { loadsRoutes } from "./modules/loads/loads.routes";
import { startReleasePoller } from "./modules/loads/release-engine";
import { locationsRoutes } from "./modules/locations/locations.routes";
import { marketplaceRoutes } from "./modules/marketplace/marketplace.routes";
import { blocksRoutes } from "./modules/network/blocks.routes";
import { carrierGroupsRoutes } from "./modules/network/carrier-groups.routes";
import { companyProfileRoutes } from "./modules/network/company-profile.routes";
import { connectionsRoutes } from "./modules/network/connections.routes";
import { facilityScopeRoutes } from "./modules/network/facility-scope.routes";
import { followsRoutes } from "./modules/network/follows.routes";
import { preferencesRoutes } from "./modules/network/preferences.routes";
import { offersRoutes } from "./modules/offers/offers.routes";
import { pricingRoutes } from "./modules/pricing/pricing.routes";

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
      await api.register(companiesRoutes);
      await api.register(locationsRoutes);
      await api.register(equipmentRoutes);
      await api.register(loadsRoutes);
      await api.register(checkInsRoutes);
      await api.register(documentsRoutes);
      // Marketplace (Milestone 2)
      await api.register(carrierProfileRoutes);
      await api.register(pricingRoutes);
      await api.register(marketplaceRoutes);
      await api.register(offersRoutes);
      await api.register(adminMarketplaceRoutes);
      // Relationship network + facility scope (Milestone 4 Phase 2)
      await api.register(followsRoutes);
      await api.register(connectionsRoutes);
      await api.register(companyProfileRoutes);
      await api.register(preferencesRoutes);
      await api.register(blocksRoutes);
      await api.register(carrierGroupsRoutes);
      await api.register(facilityScopeRoutes);
      // Dashboard + Attention Center (Milestone 4 Phase 8)
      await api.register(dashboardRoutes);
    },
    { prefix: "/api" },
  );

  // Freight audience release engine (Milestone 4 Phase 4). DB rows remain
  // the source of truth throughout — this poller only ever claims and
  // executes PENDING releases that are already due; a process restart loses
  // nothing (see release-engine.ts). Not started under `test` — the
  // integration suite drives release execution explicitly via
  // `processDueReleases()` so it stays deterministic and doesn't leak an
  // interval timer per test-app instance.
  if (env.NODE_ENV !== "test") {
    const poller = startReleasePoller(app.prisma, app.log);
    app.addHook("onClose", async () => poller.stop());
  }

  return app;
}
