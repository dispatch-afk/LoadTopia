import { createCheckInSchema, uuidSchema } from "@loadtopia/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { writeAudit } from "../../lib/audit";
import { CheckInsService } from "./check-ins.service";

const loadIdParam = z.object({ id: uuidSchema });

/**
 * Manual operational check-ins (Milestone 3).
 *
 *   GET  /api/loads/:id/check-ins   history — any authorized load reader
 *   POST /api/loads/:id/check-ins   record one — assigned carrier only
 *
 * There is deliberately no PATCH or DELETE: check-ins are append-only.
 */
export async function checkInsRoutes(app: FastifyInstance): Promise<void> {
  const service = new CheckInsService(app.prisma);

  app.get("/loads/:id/check-ins", { preHandler: [app.requireActiveCompany] }, async (request) => {
    const actor = request.currentUser!;
    const { id } = loadIdParam.parse(request.params);
    return { data: await service.list(actor, id) };
  });

  app.post(
    "/loads/:id/check-ins",
    { preHandler: [app.requireCompanyPermission("shipment:operate:assigned")] },
    async (request, reply) => {
      const actor = request.currentUser!;
      const { id } = loadIdParam.parse(request.params);
      const input = createCheckInSchema.parse(request.body);
      const checkIn = await service.create(actor, id, input);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "load.check_in",
        entityType: "load",
        entityId: id,
        data: { checkInId: checkIn.id },
      });
      reply.status(201);
      return checkIn;
    },
  );
}
