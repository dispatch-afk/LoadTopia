import { Permission } from "@loadtopia/domain";
import { uuidSchema } from "@loadtopia/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { writeAudit } from "../../lib/audit";
import { ConnectionsService } from "./connections.service";

const companyIdParam = z.object({ companyId: uuidSchema });
const idParam = z.object({ id: uuidSchema });

export async function connectionsRoutes(app: FastifyInstance): Promise<void> {
  const service = new ConnectionsService(app.prisma);

  app.post(
    "/companies/:companyId/connections",
    { preHandler: [app.requireCompanyPermission(Permission.NETWORK_REQUEST)] },
    async (request, reply) => {
      const actor = request.currentUser!;
      const { companyId } = companyIdParam.parse(request.params);
      const connection = await service.request(actor, companyId);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "connection.request",
        entityType: "company_connection",
        entityId: connection.id,
        data: { targetCompanyId: companyId },
      });
      reply.status(201);
      return connection;
    },
  );

  app.get(
    "/connections",
    { preHandler: [app.requireCompanyPermission(Permission.NETWORK_REQUEST)] },
    async (request) => {
      return { data: await service.list(request.currentUser!) };
    },
  );

  app.get(
    "/connections/:id",
    { preHandler: [app.requireCompanyPermission(Permission.NETWORK_REQUEST)] },
    async (request) => {
      const { id } = idParam.parse(request.params);
      return service.getById(request.currentUser!, id);
    },
  );

  app.post(
    "/connections/:id/accept",
    { preHandler: [app.requireCompanyPermission(Permission.NETWORK_MANAGE)] },
    async (request) => {
      const actor = request.currentUser!;
      const { id } = idParam.parse(request.params);
      const connection = await service.accept(actor, id);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "connection.accept",
        entityType: "company_connection",
        entityId: id,
      });
      return connection;
    },
  );

  app.post(
    "/connections/:id/decline",
    { preHandler: [app.requireCompanyPermission(Permission.NETWORK_MANAGE)] },
    async (request) => {
      const actor = request.currentUser!;
      const { id } = idParam.parse(request.params);
      const connection = await service.decline(actor, id);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "connection.decline",
        entityType: "company_connection",
        entityId: id,
      });
      return connection;
    },
  );

  app.post(
    "/connections/:id/disconnect",
    { preHandler: [app.requireCompanyPermission(Permission.NETWORK_MANAGE)] },
    async (request) => {
      const actor = request.currentUser!;
      const { id } = idParam.parse(request.params);
      const connection = await service.disconnect(actor, id);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "connection.disconnect",
        entityType: "company_connection",
        entityId: id,
      });
      return connection;
    },
  );
}
