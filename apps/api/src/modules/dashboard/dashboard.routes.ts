import type { FastifyInstance } from "fastify";
import { DashboardService } from "./dashboard.service";

/**
 * GET /dashboard/summary — role-aware operational facts for the current
 * authenticated actor's ACTIVE company (Milestone 4 Phase 8). Never trusts
 * a client-provided role/company — the response is derived entirely from
 * `request.currentUser`, exactly like every other authenticated read.
 */
export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  const service = new DashboardService(app.prisma, app.providers, app.log);

  app.get(
    "/dashboard/summary",
    { preHandler: [app.requireActiveCompany] },
    async (request) => {
      const actor = request.currentUser!;
      return service.getSummary(actor);
    },
  );
}
