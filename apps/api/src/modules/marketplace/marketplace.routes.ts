import { createOfferSchema, marketplaceSearchSchema, uuidSchema } from "@loadtopia/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { writeAudit } from "../../lib/audit";
import { MarketplaceService } from "./marketplace.service";

const idParam = z.object({ id: uuidSchema });

/**
 * Carrier-facing marketplace. Order per request: authenticate → active company →
 * permission (marketplace:browse / offer:create) → board access & eligibility
 * (server-authoritative) → validate → execute.
 *
 *   GET  /marketplace/loads              the load board (filtered, paginated)
 *   GET  /marketplace/loads/:id          one load's marketplace detail
 *   POST /marketplace/loads/:id/offers   submit an offer (carrier)
 *   GET  /marketplace/loads/:id/offers   this carrier's own negotiation, if any
 */
export async function marketplaceRoutes(app: FastifyInstance): Promise<void> {
  const service = new MarketplaceService(app.prisma);

  const writeLimit = {
    rateLimit: {
      max: app.env.MARKETPLACE_WRITE_RATE_LIMIT_MAX,
      timeWindow: app.env.MARKETPLACE_WRITE_RATE_LIMIT_WINDOW,
    },
  };

  app.get(
    "/marketplace/loads",
    { preHandler: [app.requireCompanyPermission("marketplace:browse")] },
    async (request) => {
      const actor = request.currentUser!;
      const q = marketplaceSearchSchema.parse(request.query);
      return service.listLoads(actor, q);
    },
  );

  app.get(
    "/marketplace/loads/:id",
    { preHandler: [app.requireCompanyPermission("marketplace:browse")] },
    async (request) => {
      const actor = request.currentUser!;
      const { id } = idParam.parse(request.params);
      return service.getLoad(actor, id);
    },
  );

  app.post(
    "/marketplace/loads/:id/offers",
    { config: writeLimit, preHandler: [app.requireCompanyPermission("offer:create")] },
    async (request, reply) => {
      const actor = request.currentUser!;
      const { id } = idParam.parse(request.params);
      const input = createOfferSchema.parse(request.body);
      const { thread, created } = await service.createOffer(actor, id, input);
      if (created) {
        await writeAudit(app.prisma, request, {
          actorUserId: actor.userId,
          action: "offer.create",
          entityType: "offer_thread",
          entityId: thread.threadId,
          data: {
            loadId: id,
            amount: thread.currentAmount,
            currency: thread.currentCurrency,
          },
        });
      }
      reply.status(created ? 201 : 200);
      return thread;
    },
  );

  app.get(
    "/marketplace/loads/:id/offers",
    { preHandler: [app.requireCompanyPermission("offer:read:own")] },
    async (request) => {
      const actor = request.currentUser!;
      const { id } = idParam.parse(request.params);
      return { thread: await service.myThreadForLoad(actor, id) };
    },
  );
}
