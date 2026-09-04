import { pricingEstimateSchema, uuidSchema } from "@loadtopia/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { writeAudit } from "../../lib/audit";
import { PricingService } from "./pricing.service";

const loadIdParam = z.object({ id: uuidSchema });

export async function pricingRoutes(app: FastifyInstance): Promise<void> {
  const service = new PricingService(app.prisma, app.providers.pricing);

  app.post(
    "/pricing/estimate",
    { preHandler: [app.requireCompanyPermission("pricing:estimate")] },
    async (request) => {
      const actor = request.currentUser!;
      const input = pricingEstimateSchema.parse(request.body);
      const estimate = await service.estimate(actor, input);
      if (estimate.snapshotId) {
        await writeAudit(app.prisma, request, {
          actorUserId: actor.userId,
          action: "pricing.snapshot",
          entityType: "pricing_snapshot",
          entityId: estimate.snapshotId,
          data: { loadId: (input as { loadId?: string }).loadId, isMock: estimate.isMock },
        });
      }
      return estimate;
    },
  );

  // Shipper: the immutable pricing snapshots captured for one of its own loads
  // (post-time snapshot + any explicit estimates). Carriers do not see these.
  app.get(
    "/loads/:id/pricing",
    { preHandler: [app.requireCompanyPermission("pricing:estimate")] },
    async (request) => {
      const actor = request.currentUser!;
      const { id } = loadIdParam.parse(request.params);
      return { data: await service.listForLoad(actor, id) };
    },
  );
}
