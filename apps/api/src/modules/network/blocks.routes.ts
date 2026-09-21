import { Permission } from "@loadtopia/domain";
import { uuidSchema } from "@loadtopia/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { writeAudit } from "../../lib/audit";
import { BlocksService } from "./blocks.service";

const companyIdParam = z.object({ companyId: uuidSchema });
const blockIdParam = z.object({ blockId: uuidSchema });

export async function blocksRoutes(app: FastifyInstance): Promise<void> {
  const service = new BlocksService(app.prisma);

  app.post(
    "/companies/:companyId/block",
    { preHandler: [app.requireCompanyPermission(Permission.NETWORK_MANAGE)] },
    async (request, reply) => {
      const actor = request.currentUser!;
      const { companyId } = companyIdParam.parse(request.params);
      const block = await service.block(actor, companyId);
      // Audit entry records the block for internal security review only —
      // never returned to the blocked company through any API response.
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "company.block",
        entityType: "company_block",
        entityId: block.id,
        data: { blockedCompanyId: companyId, status: block.status },
      });
      reply.status(201);
      return block;
    },
  );

  app.post(
    "/companies/:companyId/unblock",
    { preHandler: [app.requireCompanyPermission(Permission.NETWORK_MANAGE)] },
    async (request) => {
      const actor = request.currentUser!;
      const { companyId } = companyIdParam.parse(request.params);
      const block = await service.unblock(actor, companyId);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "company.unblock",
        entityType: "company_block",
        entityId: block.id,
        data: { blockedCompanyId: companyId },
      });
      return block;
    },
  );

  app.post(
    "/blocks/:blockId/recheck-continuity",
    { preHandler: [app.requireCompanyPermission(Permission.NETWORK_MANAGE)] },
    async (request) => {
      const { blockId } = blockIdParam.parse(request.params);
      return service.recheckContinuity(request.currentUser!, blockId);
    },
  );

  app.get(
    "/blocks",
    { preHandler: [app.requireCompanyPermission(Permission.NETWORK_REQUEST)] },
    async (request) => {
      return { data: await service.list(request.currentUser!) };
    },
  );
}
