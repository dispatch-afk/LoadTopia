import { Permission } from "@loadtopia/domain";
import { uuidSchema } from "@loadtopia/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { FollowsService } from "./follows.service";

const companyIdParam = z.object({ companyId: uuidSchema });

export async function followsRoutes(app: FastifyInstance): Promise<void> {
  const service = new FollowsService(app.prisma);

  app.post(
    "/companies/:companyId/follow",
    { preHandler: [app.requireCompanyPermission(Permission.NETWORK_REQUEST)] },
    async (request, reply) => {
      const { companyId } = companyIdParam.parse(request.params);
      const follow = await service.follow(request.currentUser!, companyId);
      reply.status(201);
      return follow;
    },
  );

  app.delete(
    "/companies/:companyId/follow",
    { preHandler: [app.requireCompanyPermission(Permission.NETWORK_REQUEST)] },
    async (request, reply) => {
      const { companyId } = companyIdParam.parse(request.params);
      await service.unfollow(request.currentUser!, companyId);
      return reply.status(204).send();
    },
  );

  app.get(
    "/follows",
    { preHandler: [app.requireCompanyPermission(Permission.NETWORK_REQUEST)] },
    async (request) => {
      return { data: await service.list(request.currentUser!) };
    },
  );
}
