import {
  cancelLoadSchema,
  createLoadSchema,
  listLoadsSchema,
  updateLoadSchema,
  uuidSchema,
} from "@loadtopia/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { writeAudit } from "../../lib/audit";
import { assertResourceScope } from "../../lib/scoped-resource";
import { LoadsService } from "./loads.service";

const idParam = z.object({ id: uuidSchema });

export async function loadsRoutes(app: FastifyInstance): Promise<void> {
  const service = new LoadsService(app.prisma, app.providers, app.log);

  app.post("/loads", { preHandler: [app.requireActiveCompany] }, async (request, reply) => {
    const actor = request.currentUser!;
    const input = createLoadSchema.parse(request.body);
    const load = await service.create(actor, actor.companyId!, input);
    await writeAudit(app.prisma, request, {
      actorUserId: actor.userId,
      action: "load.create",
      entityType: "load",
      entityId: load.id,
      data: { referenceNumber: load.referenceNumber },
    });
    reply.status(201);
    return load;
  });

  app.get("/loads", { preHandler: [app.requireActiveCompany] }, async (request) => {
    const actor = request.currentUser!;
    const q = listLoadsSchema.parse(request.query);
    return service.list(actor, actor.companyId!, q);
  });

  app.get("/loads/:id", { preHandler: [app.requireActiveCompany] }, async (request) => {
    const actor = request.currentUser!;
    const { id } = idParam.parse(request.params);
    return service.getById(actor, id);
  });

  app.patch("/loads/:id", { preHandler: [app.requireActiveCompany] }, async (request) => {
    const actor = request.currentUser!;
    const { id } = idParam.parse(request.params);
    await assertResourceScope(app.prisma, actor, "load", id);
    const input = updateLoadSchema.parse(request.body);
    const load = await service.update(actor, id, input);
    await writeAudit(app.prisma, request, {
      actorUserId: actor.userId,
      action: "load.update",
      entityType: "load",
      entityId: id,
      data: { fields: Object.keys(input) },
    });
    return load;
  });

  app.delete("/loads/:id", { preHandler: [app.requireActiveCompany] }, async (request, reply) => {
    const actor = request.currentUser!;
    const { id } = idParam.parse(request.params);
    await service.remove(actor, id);
    await writeAudit(app.prisma, request, {
      actorUserId: actor.userId,
      action: "load.delete",
      entityType: "load",
      entityId: id,
    });
    reply.status(204);
    return null;
  });

  app.post("/loads/:id/post", { preHandler: [app.requireActiveCompany] }, async (request) => {
    const actor = request.currentUser!;
    const { id } = idParam.parse(request.params);
    const load = await service.post(actor, id);
    await writeAudit(app.prisma, request, {
      actorUserId: actor.userId,
      action: "load.post",
      entityType: "load",
      entityId: id,
    });
    return load;
  });

  app.post("/loads/:id/unpost", { preHandler: [app.requireActiveCompany] }, async (request) => {
    const actor = request.currentUser!;
    const { id } = idParam.parse(request.params);
    const load = await service.unpost(actor, id);
    await writeAudit(app.prisma, request, {
      actorUserId: actor.userId,
      action: "load.unpost",
      entityType: "load",
      entityId: id,
    });
    return load;
  });

  app.post("/loads/:id/cancel", { preHandler: [app.requireActiveCompany] }, async (request) => {
    const actor = request.currentUser!;
    const { id } = idParam.parse(request.params);
    await assertResourceScope(app.prisma, actor, "load", id);
    const { reason } = cancelLoadSchema.parse(request.body ?? {});
    const load = await service.cancel(actor, id, reason);
    await writeAudit(app.prisma, request, {
      actorUserId: actor.userId,
      action: "load.cancel",
      entityType: "load",
      entityId: id,
      data: reason ? { reason } : undefined,
    });
    return load;
  });
}
