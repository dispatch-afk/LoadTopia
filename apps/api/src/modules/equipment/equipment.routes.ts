import {
  createEquipmentSchema,
  paginationSchema,
  updateEquipmentSchema,
  uuidSchema,
} from "@loadtopia/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { writeAudit } from "../../lib/audit";
import { assertResourceScope } from "../../lib/scoped-resource";
import { EquipmentService } from "./equipment.service";

const idParam = z.object({ id: uuidSchema });
const listQuery = paginationSchema.extend({
  includeInactive: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => v === true || v === "true")
    .optional(),
});

export async function equipmentRoutes(app: FastifyInstance): Promise<void> {
  const service = new EquipmentService(app.prisma);

  app.post("/equipment", { preHandler: [app.requireActiveCompany] }, async (request, reply) => {
    const actor = request.currentUser!;
    const input = createEquipmentSchema.parse(request.body);
    const equipment = await service.create(actor, actor.companyId!, input);
    await writeAudit(app.prisma, request, {
      actorUserId: actor.userId,
      action: "equipment.create",
      entityType: "equipment",
      entityId: equipment.id,
    });
    reply.status(201);
    return equipment;
  });

  app.get("/equipment", { preHandler: [app.requireActiveCompany] }, async (request) => {
    const actor = request.currentUser!;
    const q = listQuery.parse(request.query);
    return service.list(actor, actor.companyId!, q);
  });

  app.get("/equipment/:id", { preHandler: [app.requireActiveCompany] }, async (request) => {
    const actor = request.currentUser!;
    const { id } = idParam.parse(request.params);
    return service.getById(actor, id);
  });

  app.patch("/equipment/:id", { preHandler: [app.requireActiveCompany] }, async (request) => {
    const actor = request.currentUser!;
    const { id } = idParam.parse(request.params);
    await assertResourceScope(app.prisma, actor, "equipment", id);
    const input = updateEquipmentSchema.parse(request.body);
    const equipment = await service.update(actor, id, input);
    await writeAudit(app.prisma, request, {
      actorUserId: actor.userId,
      action: "equipment.update",
      entityType: "equipment",
      entityId: id,
      data: { fields: Object.keys(input) },
    });
    return equipment;
  });

  app.delete("/equipment/:id", { preHandler: [app.requireActiveCompany] }, async (request) => {
    const actor = request.currentUser!;
    const { id } = idParam.parse(request.params);
    const equipment = await service.deactivate(actor, id);
    await writeAudit(app.prisma, request, {
      actorUserId: actor.userId,
      action: "equipment.deactivate",
      entityType: "equipment",
      entityId: id,
    });
    return equipment;
  });
}
