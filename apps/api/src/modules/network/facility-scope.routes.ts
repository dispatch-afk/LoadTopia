import { Permission } from "@loadtopia/domain";
import { setFacilityScopeSchema, uuidSchema } from "@loadtopia/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { writeAudit } from "../../lib/audit";
import { FacilityScopeService } from "./facility-scope.service";

const membershipIdParam = z.object({ membershipId: uuidSchema });

export async function facilityScopeRoutes(app: FastifyInstance): Promise<void> {
  const service = new FacilityScopeService(app.prisma);

  app.get(
    "/memberships/:membershipId/facility-scope",
    { preHandler: [app.requireCompanyPermission(Permission.MEMBERSHIP_READ)] },
    async (request) => {
      const { membershipId } = membershipIdParam.parse(request.params);
      return service.get(request.currentUser!, membershipId);
    },
  );

  app.put(
    "/memberships/:membershipId/facility-scope",
    { preHandler: [app.requireCompanyPermission(Permission.FACILITY_SCOPE_MANAGE)] },
    async (request) => {
      const actor = request.currentUser!;
      const { membershipId } = membershipIdParam.parse(request.params);
      const input = setFacilityScopeSchema.parse(request.body);
      const scope = await service.set(actor, membershipId, input.locationIds);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "facility-scope.set",
        entityType: "membership",
        entityId: membershipId,
        data: { locationCount: input.locationIds.length },
      });
      return scope;
    },
  );
}
