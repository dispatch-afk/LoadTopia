import { Permission } from "@loadtopia/domain";
import { setCarrierPreferenceSchema, uuidSchema } from "@loadtopia/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { writeAudit } from "../../lib/audit";
import { notFound } from "../../lib/errors";
import { PreferencesService } from "./preferences.service";

const companyIdParam = z.object({ carrierCompanyId: uuidSchema });

export async function preferencesRoutes(app: FastifyInstance): Promise<void> {
  const service = new PreferencesService(app.prisma);

  app.put(
    "/companies/:carrierCompanyId/preference",
    { preHandler: [app.requireCompanyPermission(Permission.NETWORK_MANAGE)] },
    async (request, reply) => {
      const actor = request.currentUser!;
      const { carrierCompanyId } = companyIdParam.parse(request.params);
      const input = setCarrierPreferenceSchema.parse(request.body);
      const pref = await service.set(actor, carrierCompanyId, input.preference);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "carrier-preference.set",
        entityType: "carrier_preference",
        entityId: carrierCompanyId,
        data: { preference: input.preference },
      });
      reply.status(200);
      return pref;
    },
  );

  app.delete(
    "/companies/:carrierCompanyId/preference",
    { preHandler: [app.requireCompanyPermission(Permission.NETWORK_MANAGE)] },
    async (request, reply) => {
      const actor = request.currentUser!;
      const { carrierCompanyId } = companyIdParam.parse(request.params);
      await service.clear(actor, carrierCompanyId);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "carrier-preference.clear",
        entityType: "carrier_preference",
        entityId: carrierCompanyId,
      });
      return reply.status(204).send();
    },
  );

  app.get(
    "/companies/:carrierCompanyId/preference",
    { preHandler: [app.requireCompanyPermission(Permission.NETWORK_REQUEST)] },
    async (request) => {
      const actor = request.currentUser!;
      const { carrierCompanyId } = companyIdParam.parse(request.params);
      const pref = await service.get(actor, carrierCompanyId);
      if (!pref) throw notFound("No preference set for this carrier");
      return pref;
    },
  );

  app.get(
    "/preferences",
    { preHandler: [app.requireCompanyPermission(Permission.NETWORK_REQUEST)] },
    async (request) => {
      return { data: await service.list(request.currentUser!) };
    },
  );
}
