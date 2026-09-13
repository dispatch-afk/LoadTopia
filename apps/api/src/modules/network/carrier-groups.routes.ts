import { Permission } from "@loadtopia/domain";
import {
  addCarrierGroupMemberSchema,
  createCarrierGroupSchema,
  updateCarrierGroupSchema,
  uuidSchema,
} from "@loadtopia/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { writeAudit } from "../../lib/audit";
import { CarrierGroupsService } from "./carrier-groups.service";

const idParam = z.object({ id: uuidSchema });
const memberParam = z.object({ id: uuidSchema, carrierCompanyId: uuidSchema });

export async function carrierGroupsRoutes(app: FastifyInstance): Promise<void> {
  const service = new CarrierGroupsService(app.prisma);

  app.get(
    "/carrier-groups",
    { preHandler: [app.requireCompanyPermission(Permission.NETWORK_REQUEST)] },
    async (request) => {
      return { data: await service.list(request.currentUser!) };
    },
  );

  app.get(
    "/carrier-groups/:id",
    { preHandler: [app.requireCompanyPermission(Permission.NETWORK_REQUEST)] },
    async (request) => {
      const { id } = idParam.parse(request.params);
      return service.getById(request.currentUser!, id);
    },
  );

  app.get(
    "/carrier-groups/:id/eligible-carriers",
    { preHandler: [app.requireCompanyPermission(Permission.NETWORK_REQUEST)] },
    async (request) => {
      const { id } = idParam.parse(request.params);
      return { data: await service.listEligibleCarriers(request.currentUser!, id) };
    },
  );

  app.post(
    "/carrier-groups",
    { preHandler: [app.requireCompanyPermission(Permission.NETWORK_MANAGE)] },
    async (request, reply) => {
      const actor = request.currentUser!;
      const input = createCarrierGroupSchema.parse(request.body);
      const group = await service.create(actor, input.name);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "carrier-group.create",
        entityType: "carrier_group",
        entityId: group.id,
        data: { name: group.name },
      });
      reply.status(201);
      return group;
    },
  );

  app.patch(
    "/carrier-groups/:id",
    { preHandler: [app.requireCompanyPermission(Permission.NETWORK_MANAGE)] },
    async (request) => {
      const actor = request.currentUser!;
      const { id } = idParam.parse(request.params);
      const input = updateCarrierGroupSchema.parse(request.body);
      const group = await service.update(actor, id, input.name);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "carrier-group.update",
        entityType: "carrier_group",
        entityId: id,
        data: { name: group.name },
      });
      return group;
    },
  );

  app.delete(
    "/carrier-groups/:id",
    { preHandler: [app.requireCompanyPermission(Permission.NETWORK_MANAGE)] },
    async (request, reply) => {
      const actor = request.currentUser!;
      const { id } = idParam.parse(request.params);
      await service.remove(actor, id);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "carrier-group.delete",
        entityType: "carrier_group",
        entityId: id,
      });
      return reply.status(204).send();
    },
  );

  app.post(
    "/carrier-groups/:id/members",
    { preHandler: [app.requireCompanyPermission(Permission.NETWORK_MANAGE)] },
    async (request, reply) => {
      const actor = request.currentUser!;
      const { id } = idParam.parse(request.params);
      const input = addCarrierGroupMemberSchema.parse(request.body);
      const member = await service.addMember(actor, id, input.carrierCompanyId);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "carrier-group.add-member",
        entityType: "carrier_group",
        entityId: id,
        data: { carrierCompanyId: input.carrierCompanyId },
      });
      reply.status(201);
      return member;
    },
  );

  app.delete(
    "/carrier-groups/:id/members/:carrierCompanyId",
    { preHandler: [app.requireCompanyPermission(Permission.NETWORK_MANAGE)] },
    async (request, reply) => {
      const actor = request.currentUser!;
      const { id, carrierCompanyId } = memberParam.parse(request.params);
      await service.removeMember(actor, id, carrierCompanyId);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "carrier-group.remove-member",
        entityType: "carrier_group",
        entityId: id,
        data: { carrierCompanyId },
      });
      return reply.status(204).send();
    },
  );
}
