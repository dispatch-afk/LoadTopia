import {
  createLocationSchema,
  paginationSchema,
  updateLocationSchema,
  uuidSchema,
} from "@loadtopia/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { writeAudit } from "../../lib/audit";
import { assertResourceScope } from "../../lib/scoped-resource";
import { LocationsService } from "./locations.service";

const idParam = z.object({ id: uuidSchema });
const listQuery = paginationSchema.extend({
  includeInactive: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => v === true || v === "true")
    .optional(),
});

export async function locationsRoutes(app: FastifyInstance): Promise<void> {
  const service = new LocationsService(app.prisma, app.providers.geocoding, app.log);

  app.post("/locations", { preHandler: [app.requireActiveCompany] }, async (request, reply) => {
    const actor = request.currentUser!;
    const input = createLocationSchema.parse(request.body);
    const location = await service.create(actor, actor.companyId!, input);
    await writeAudit(app.prisma, request, {
      actorUserId: actor.userId,
      action: "location.create",
      entityType: "location",
      entityId: location.id,
      data: { companyId: actor.companyId },
    });
    reply.status(201);
    return location;
  });

  app.get("/locations", { preHandler: [app.requireActiveCompany] }, async (request) => {
    const actor = request.currentUser!;
    const q = listQuery.parse(request.query);
    return service.list(actor, actor.companyId!, q);
  });

  app.get("/locations/:id", { preHandler: [app.requireActiveCompany] }, async (request) => {
    const actor = request.currentUser!;
    const { id } = idParam.parse(request.params);
    return service.getById(actor, id);
  });

  app.patch("/locations/:id", { preHandler: [app.requireActiveCompany] }, async (request) => {
    const actor = request.currentUser!;
    const { id } = idParam.parse(request.params);
    await assertResourceScope(app.prisma, actor, "location", id);
    const input = updateLocationSchema.parse(request.body);
    const location = await service.update(actor, id, input);
    await writeAudit(app.prisma, request, {
      actorUserId: actor.userId,
      action: "location.update",
      entityType: "location",
      entityId: id,
      data: { fields: Object.keys(input) },
    });
    return location;
  });

  app.delete("/locations/:id", { preHandler: [app.requireActiveCompany] }, async (request) => {
    const actor = request.currentUser!;
    const { id } = idParam.parse(request.params);
    const location = await service.deactivate(actor, id);
    await writeAudit(app.prisma, request, {
      actorUserId: actor.userId,
      action: "location.deactivate",
      entityType: "location",
      entityId: id,
    });
    return location;
  });
}
