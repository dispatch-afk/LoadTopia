import {
  acceptOfferSchema,
  closeThreadSchema,
  counterOfferSchema,
  listOfferThreadsSchema,
  roundIdParamSchema,
  threadIdParamSchema,
  uuidSchema,
} from "@loadtopia/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { writeAudit } from "../../lib/audit";
import { OffersService } from "./offers.service";

const loadIdParam = z.object({ id: uuidSchema });

/**
 * Offer negotiation endpoints. Every operation is explicit (no generic PATCH):
 *
 *   POST /offers/rounds/:roundId/counter   counter the current round
 *   POST /offers/rounds/:roundId/accept    accept → ATOMIC LOAD AWARD
 *   POST /offers/threads/:threadId/reject  shipper closes a negotiation
 *   POST /offers/threads/:threadId/withdraw carrier closes its own negotiation
 *   GET  /offers                           carrier: my negotiations
 *   GET  /offers/threads/:threadId         either party: one negotiation
 *   GET  /loads/:id/offers                 shipper: every negotiation on my load
 *
 * Offer *creation* lives under /marketplace/loads/:id/offers (carrier-scoped).
 * Order per request: authenticate → active company → permission → resource
 * scope (in the service, IDOR-safe 404) → validate body → execute.
 */
export async function offersRoutes(app: FastifyInstance): Promise<void> {
  const service = new OffersService(app.prisma);

  const writeLimit = {
    rateLimit: {
      max: app.env.MARKETPLACE_WRITE_RATE_LIMIT_MAX,
      timeWindow: app.env.MARKETPLACE_WRITE_RATE_LIMIT_WINDOW,
    },
  };
  const awardLimit = {
    rateLimit: {
      max: app.env.MARKETPLACE_AWARD_RATE_LIMIT_MAX,
      timeWindow: app.env.MARKETPLACE_AWARD_RATE_LIMIT_WINDOW,
    },
  };

  // ── counter ────────────────────────────────────────────────────────
  app.post(
    "/offers/rounds/:roundId/counter",
    {
      config: writeLimit,
      preHandler: [app.requireCompanyPermission("offer:create", "offer:respond")],
    },
    async (request) => {
      const actor = request.currentUser!;
      const { roundId } = roundIdParamSchema.parse(request.params);
      const input = counterOfferSchema.parse(request.body);
      const thread = await service.counter(actor, roundId, input);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "offer.counter",
        entityType: "offer_thread",
        entityId: thread.threadId,
        data: { loadId: thread.loadId, roundCount: thread.roundCount },
      });
      return thread;
    },
  );

  // ── accept → atomic award ──────────────────────────────────────────
  app.post(
    "/offers/rounds/:roundId/accept",
    {
      config: awardLimit,
      preHandler: [app.requireCompanyPermission("offer:create", "offer:respond")],
    },
    async (request) => {
      const actor = request.currentUser!;
      const { roundId } = roundIdParamSchema.parse(request.params);
      acceptOfferSchema.parse(request.body ?? {});
      const thread = await service.accept(actor, roundId);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "offer.accept",
        entityType: "offer_thread",
        entityId: thread.threadId,
        data: {
          loadId: thread.loadId,
          amount: thread.currentAmount,
          currency: thread.currentCurrency,
        },
      });
      return thread;
    },
  );

  // ── reject (shipper) ───────────────────────────────────────────────
  app.post(
    "/offers/threads/:threadId/reject",
    {
      config: writeLimit,
      preHandler: [app.requireCompanyPermission("offer:respond")],
    },
    async (request) => {
      const actor = request.currentUser!;
      const { threadId } = threadIdParamSchema.parse(request.params);
      const input = closeThreadSchema.parse(request.body ?? {});
      const thread = await service.closeThread(actor, threadId, "reject", input);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "offer.reject",
        entityType: "offer_thread",
        entityId: threadId,
        data: { loadId: thread.loadId },
      });
      return thread;
    },
  );

  // ── withdraw (carrier) ─────────────────────────────────────────────
  app.post(
    "/offers/threads/:threadId/withdraw",
    {
      config: writeLimit,
      preHandler: [app.requireCompanyPermission("offer:manage:own")],
    },
    async (request) => {
      const actor = request.currentUser!;
      const { threadId } = threadIdParamSchema.parse(request.params);
      const input = closeThreadSchema.parse(request.body ?? {});
      const thread = await service.closeThread(actor, threadId, "withdraw", input);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "offer.withdraw",
        entityType: "offer_thread",
        entityId: threadId,
        data: { loadId: thread.loadId },
      });
      return thread;
    },
  );

  // ── carrier: my negotiations ───────────────────────────────────────
  app.get(
    "/offers",
    { preHandler: [app.requireCompanyPermission("offer:read:own")] },
    async (request) => {
      const actor = request.currentUser!;
      const q = listOfferThreadsSchema.parse(request.query);
      return service.listCarrierThreads(actor, q);
    },
  );

  // ── either party: one negotiation ─────────────────────────────────
  app.get(
    "/offers/threads/:threadId",
    { preHandler: [app.requireCompanyPermission("offer:read:own")] },
    async (request) => {
      const actor = request.currentUser!;
      const { threadId } = threadIdParamSchema.parse(request.params);
      return service.getThread(actor, threadId);
    },
  );

  // ── shipper: every negotiation on my load ─────────────────────────
  app.get(
    "/loads/:id/offers",
    { preHandler: [app.requireCompanyPermission("offer:read:own")] },
    async (request) => {
      const actor = request.currentUser!;
      const { id } = loadIdParam.parse(request.params);
      return { data: await service.listLoadThreads(actor, id) };
    },
  );
}
