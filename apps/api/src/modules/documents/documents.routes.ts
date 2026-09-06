import { documentUploadRequestSchema, rejectPodSchema, uuidSchema } from "@loadtopia/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { writeAudit } from "../../lib/audit";
import { DocumentsService } from "./documents.service";
import { PodReviewService } from "./pod-review.service";

const loadIdParam = z.object({ id: uuidSchema });
const documentIdParam = z.object({ documentId: uuidSchema });

/**
 * Operational documents (Milestone 3).
 *
 *   POST /api/loads/:id/documents               Stage A — request an upload
 *   GET  /api/loads/:id/documents               confirmed documents for a load
 *   POST /api/load-documents/:documentId/confirm Stage B — confirm the upload
 *   GET  /api/load-documents/:documentId/download short-lived signed URL
 *
 * (DELETE + POST approve/reject are registered here too — see below.)
 */
export async function documentsRoutes(app: FastifyInstance): Promise<void> {
  const service = new DocumentsService(app.prisma, app.providers.storage);
  const podReview = new PodReviewService(app.prisma);

  // Rev. 2 Correction 12: a dedicated, generous per-user limit on the
  // storage-cost-bearing request endpoint. Every other document endpoint keeps
  // the global limit.
  const uploadRequestLimit = {
    rateLimit: {
      max: app.env.DOCUMENT_UPLOAD_RATE_LIMIT_MAX,
      timeWindow: app.env.DOCUMENT_UPLOAD_RATE_LIMIT_WINDOW,
    },
  };

  // Stage A — request. Shipper (load:update:own) OR assigned carrier
  // (shipment:operate:assigned); the load-scoped identity check is in the
  // service (canUploadOperationalDocument).
  app.post(
    "/loads/:id/documents",
    {
      config: uploadRequestLimit,
      preHandler: [app.requireCompanyPermission("shipment:operate:assigned", "load:update:own")],
    },
    async (request, reply) => {
      const actor = request.currentUser!;
      const { id } = loadIdParam.parse(request.params);
      const input = documentUploadRequestSchema.parse(request.body);
      const result = await service.requestUpload(actor, id, input);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "document.upload_request",
        entityType: "load_document",
        entityId: result.document.id,
        data: { loadId: id, docType: result.document.docType },
      });
      reply.status(201);
      return result;
    },
  );

  app.get("/loads/:id/documents", { preHandler: [app.requireActiveCompany] }, async (request) => {
    const actor = request.currentUser!;
    const { id } = loadIdParam.parse(request.params);
    return { data: await service.list(actor, id) };
  });

  // Stage B — confirm. Only the requesting company.
  app.post(
    "/load-documents/:documentId/confirm",
    { preHandler: [app.requireActiveCompany] },
    async (request) => {
      const actor = request.currentUser!;
      const { documentId } = documentIdParam.parse(request.params);
      const document = await service.confirm(actor, documentId);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "document.confirm",
        entityType: "load_document",
        entityId: documentId,
        data: { loadId: document.loadId, docType: document.docType },
      });
      return document;
    },
  );

  app.get(
    "/load-documents/:documentId/download",
    { preHandler: [app.requireActiveCompany] },
    async (request) => {
      const actor = request.currentUser!;
      const { documentId } = documentIdParam.parse(request.params);
      return service.download(actor, documentId);
    },
  );

  // Soft-remove — uploader's own company only; never a reviewed POD.
  app.delete(
    "/load-documents/:documentId",
    { preHandler: [app.requireActiveCompany] },
    async (request) => {
      const actor = request.currentUser!;
      const { documentId } = documentIdParam.parse(request.params);
      const document = await service.remove(actor, documentId);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "document.remove",
        entityType: "load_document",
        entityId: documentId,
        data: { loadId: document.loadId },
      });
      return document;
    },
  );

  // POD review — owning shipper only (load:update:own; carriers lack it).
  app.post(
    "/load-documents/:documentId/approve",
    { preHandler: [app.requireCompanyPermission("load:update:own")] },
    async (request) => {
      const actor = request.currentUser!;
      const { documentId } = documentIdParam.parse(request.params);
      const document = await podReview.approve(actor, documentId);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "document.approve",
        entityType: "load_document",
        entityId: documentId,
        data: { loadId: document.loadId },
      });
      return document;
    },
  );

  app.post(
    "/load-documents/:documentId/reject",
    { preHandler: [app.requireCompanyPermission("load:update:own")] },
    async (request) => {
      const actor = request.currentUser!;
      const { documentId } = documentIdParam.parse(request.params);
      const { reason } = rejectPodSchema.parse(request.body ?? {});
      const document = await podReview.reject(actor, documentId, reason);
      await writeAudit(app.prisma, request, {
        actorUserId: actor.userId,
        action: "document.reject",
        entityType: "load_document",
        entityId: documentId,
        data: { loadId: document.loadId },
      });
      return document;
    },
  );
}
