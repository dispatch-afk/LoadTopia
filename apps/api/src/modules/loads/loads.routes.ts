import {
  audiencePreviewSchema,
  cancelLoadSchema,
  createLoadSchema,
  listLoadsSchema,
  LoadAudienceStrategyType,
  paginationSchema,
  postLoadAudienceSchema,
  releaseNowSchema,
  rescheduleReleaseSchema,
  updateLoadSchema,
  uuidSchema,
} from "@loadtopia/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { writeAudit } from "../../lib/audit";
import { assertResourceScope } from "../../lib/scoped-resource";
import { RateConfirmationService } from "../rate-confirmations/rate-confirmation.service";
import { cancelScheduledRelease, releaseNow, rescheduleRelease } from "./release-engine";
import { LoadsService } from "./loads.service";

const idParam = z.object({ id: uuidSchema });
const releaseIdParam = z.object({ id: uuidSchema, releaseId: uuidSchema });

export async function loadsRoutes(app: FastifyInstance): Promise<void> {
  const service = new LoadsService(app.prisma, app.providers, app.log);
  const rateConfirmations = new RateConfirmationService(app.prisma, app.providers.storage, app.log);

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

  // Shipper "Shipments" workspace (Milestone 4 Phase 5) — a static route, so
  // it is matched ahead of the parametric `/loads/:id` below regardless of
  // registration order.
  app.get("/loads/shipments", { preHandler: [app.requireActiveCompany] }, async (request) => {
    const actor = request.currentUser!;
    const q = paginationSchema.parse(request.query);
    return service.listShipments(actor, actor.companyId!, q);
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

  // Review & Post. An omitted body defaults to `{ strategy: "MARKETPLACE" }`
  // — the exact historical immediate-post behavior — so this stays backward
  // compatible while the web Review & Post flow always sends an explicit
  // audience choice (see loads.service.ts#post's doc comment).
  app.post("/loads/:id/post", { preHandler: [app.requireActiveCompany] }, async (request) => {
    const actor = request.currentUser!;
    const { id } = idParam.parse(request.params);
    const input = postLoadAudienceSchema.parse(
      request.body ?? { strategy: LoadAudienceStrategyType.MARKETPLACE },
    );
    const load = await service.post(actor, id, input);
    await writeAudit(app.prisma, request, {
      actorUserId: actor.userId,
      action: "load.post",
      entityType: "load",
      entityId: id,
      data: { strategy: input.strategy },
    });
    return load;
  });

  // Non-authoritative Review & Post preview (§35 Preview vs Commit) — never
  // trusted as final; /post revalidates everything fresh at commit time.
  app.post(
    "/loads/:id/audience-preview",
    { preHandler: [app.requireActiveCompany] },
    async (request) => {
      const actor = request.currentUser!;
      const { id } = idParam.parse(request.params);
      const input = audiencePreviewSchema.parse(request.body);
      return service.previewAudience(actor, id, input);
    },
  );

  // Load detail / coverage workspace: manage a pending scheduled release.
  app.post(
    "/loads/:id/release-now",
    { preHandler: [app.requireActiveCompany] },
    async (request) => {
      const actor = request.currentUser!;
      const { id } = idParam.parse(request.params);
      const { target } = releaseNowSchema.parse(request.body);
      await releaseNow(app.prisma, actor, id, target);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "load.audience.release_now",
        entityType: "load",
        entityId: id,
        data: { target },
      });
      return service.getById(actor, id);
    },
  );

  app.post(
    "/loads/:id/audience-releases/:releaseId/reschedule",
    { preHandler: [app.requireActiveCompany] },
    async (request) => {
      const actor = request.currentUser!;
      const { id, releaseId } = releaseIdParam.parse(request.params);
      const { releaseAt } = rescheduleReleaseSchema.parse(request.body);
      await rescheduleRelease(app.prisma, actor, id, releaseId, new Date(releaseAt));
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "load.audience.release_rescheduled",
        entityType: "load",
        entityId: id,
        data: { releaseId, releaseAt },
      });
      return service.getById(actor, id);
    },
  );

  app.post(
    "/loads/:id/audience-releases/:releaseId/cancel",
    { preHandler: [app.requireActiveCompany] },
    async (request) => {
      const actor = request.currentUser!;
      const { id, releaseId } = releaseIdParam.parse(request.params);
      await cancelScheduledRelease(app.prisma, actor, id, releaseId);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "load.audience.release_cancelled",
        entityType: "load",
        entityId: id,
        data: { releaseId },
      });
      return service.getById(actor, id);
    },
  );

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

  app.post("/loads/:id/assign", { preHandler: [app.requireActiveCompany] }, async (request) => {
    const actor = request.currentUser!;
    const { id } = idParam.parse(request.params);
    const load = await service.assign(actor, id);
    await writeAudit(app.prisma, request, {
      actorUserId: actor.userId,
      action: "load.assign",
      entityType: "load",
      entityId: id,
      data: { carrierCompanyId: load.marketplace.award?.carrierCompanyId ?? null },
    });
    return load;
  });

  // Milestone 3: carrier operational lifecycle. Explicit action endpoints (no
  // generic status PATCH). Gated by the SHIPMENT_OPERATE_ASSIGNED permission in
  // the preHandler, then by canOperateShipment() against THIS load's carrier
  // company in the service (404 for readers who cannot see the load, 403 for a
  // reader who is not the assigned carrier, e.g. the shipper). COMPLETE is
  // deliberately NOT exposed here — it gates on approved-POD readiness.
  const operateShipment = {
    preHandler: [app.requireCompanyPermission("shipment:operate:assigned")],
  };

  app.post("/loads/:id/pickup", operateShipment, async (request) => {
    const actor = request.currentUser!;
    const { id } = idParam.parse(request.params);
    const load = await service.pickup(actor, id);
    await writeAudit(app.prisma, request, {
      actorUserId: actor.userId,
      action: "load.pickup",
      entityType: "load",
      entityId: id,
    });
    return load;
  });

  app.post("/loads/:id/in-transit", operateShipment, async (request) => {
    const actor = request.currentUser!;
    const { id } = idParam.parse(request.params);
    const load = await service.startTransit(actor, id);
    await writeAudit(app.prisma, request, {
      actorUserId: actor.userId,
      action: "load.in_transit",
      entityType: "load",
      entityId: id,
    });
    return load;
  });

  app.post("/loads/:id/deliver", operateShipment, async (request) => {
    const actor = request.currentUser!;
    const { id } = idParam.parse(request.params);
    const load = await service.deliver(actor, id);
    await writeAudit(app.prisma, request, {
      actorUserId: actor.userId,
      action: "load.deliver",
      entityType: "load",
      entityId: id,
    });
    return load;
  });

  // DELIVERED -> COMPLETED. Shipper-owned (load:update:own, like /assign) —
  // NOT the carrier-operation permission. Gated server-side by an approved,
  // active POD (assertCompletionReadiness, a pure DB query inside the txn).
  app.post(
    "/loads/:id/complete",
    { preHandler: [app.requireCompanyPermission("load:update:own")] },
    async (request) => {
      const actor = request.currentUser!;
      const { id } = idParam.parse(request.params);
      const load = await service.complete(actor, id);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "load.complete",
        entityType: "load",
        entityId: id,
      });
      return load;
    },
  );

  // Rate Confirmation (Milestone 3). Readable by the owning shipper, the
  // assigned/winning carrier, and admin — everyone else 404s (IDOR-safe).
  // Lazily completes generation if the rendered PDF is not ready yet; returns a
  // stable RATE_CONFIRMATION_NOT_AVAILABLE for any load awarded before this
  // feature shipped (no snapshot is ever fabricated).
  app.get(
    "/loads/:id/rate-confirmation",
    { preHandler: [app.requireActiveCompany] },
    async (request) => {
      const actor = request.currentUser!;
      const { id } = idParam.parse(request.params);
      return rateConfirmations.getForLoad(actor, id);
    },
  );

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
