import { adminSetEligibilitySchema, uuidSchema } from "@loadtopia/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { writeAudit } from "../../lib/audit";
import { AdminMarketplaceService } from "./admin-marketplace.service";

const companyIdParam = z.object({ companyId: uuidSchema });

/**
 * Platform-staff marketplace endpoints. All behind `marketplace:admin`
 * (ADMIN role only — staff accounts have no active company, so
 * `requirePermission` is used rather than `requireCompanyPermission`).
 */
export async function adminMarketplaceRoutes(app: FastifyInstance): Promise<void> {
  const service = new AdminMarketplaceService(app.prisma, app.providers);

  app.get(
    "/admin/carrier-profiles",
    { preHandler: [app.requirePermission("marketplace:admin")] },
    async () => ({ data: await service.listCarrierProfiles() }),
  );

  app.patch(
    "/admin/carrier-profiles/:companyId",
    { preHandler: [app.requirePermission("marketplace:admin")] },
    async (request) => {
      const actor = request.currentUser!;
      const { companyId } = companyIdParam.parse(request.params);
      const input = adminSetEligibilitySchema.parse(request.body);
      const profile = await service.setEligibility(companyId, input, actor.userId);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "marketplace.eligibility.override",
        entityType: "carrier_profile",
        entityId: profile.id,
        data: { companyId, eligibility: input.marketplaceEligibility, reason: input.reason },
      });
      return { profile };
    },
  );

  app.get(
    "/admin/marketplace/overview",
    { preHandler: [app.requirePermission("marketplace:admin")] },
    async () => service.overview(),
  );
}
