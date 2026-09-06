import type { PrismaClient } from "@loadtopia/db";
import {
  assertCanReadLoad,
  assertCanUploadOperationalDocument,
  buildDocumentUploadedEvent,
  isAdmin,
  isWithinOperationalActivityWindow,
} from "@loadtopia/domain";
import { type StorageProvider, StorageProviderError } from "@loadtopia/providers";
import {
  type AuthenticatedActor,
  type DocumentDownloadView,
  type DocumentUploadRequestInput,
  type DocumentUploadRequestView,
  type DocumentView,
  MAX_OPERATIONAL_DOCUMENT_BYTES,
} from "@loadtopia/shared";
import { randomUUID } from "node:crypto";
import { AppError, conflict, forbidden, notFound, storageUnavailable } from "../../lib/errors";
import { appendLoadEvent } from "../../lib/load-lifecycle";
import { operationalDocumentStorageKey } from "./document-storage";
import { toDocumentView } from "./documents.serializer";

/**
 * Operational documents — BOL / POD / OTHER (Milestone 3).
 *
 * Two-stage upload: `requestUpload` creates an UNCONFIRMED `load_documents` row
 * (an authorized upload attempt — not a document LoadTopia possesses) and
 * returns signed direct-to-storage instructions; `confirm` inspects the stored
 * object with `headObject`, enforces the size/type rules, and only then marks
 * the row confirmed (and a POD `PENDING_REVIEW`). Abandoned intents never reach
 * confirm and never satisfy review, download, or completion.
 *
 * Every storage-dependent step degrades to 503 on an outage without touching
 * DB truth. No object bytes are ever inspected beyond length/type metadata —
 * no OCR, no MIME sniffing, no malware scan.
 */
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: StorageProvider,
  ) {}

  /** Stage A. Authorize (shipper OR assigned carrier), validate, allocate id +
   *  deterministic key, sign the upload, persist the unconfirmed row. */
  async requestUpload(
    actor: AuthenticatedActor,
    loadId: string,
    input: DocumentUploadRequestInput,
  ): Promise<DocumentUploadRequestView> {
    const load = await this.prisma.load.findUnique({
      where: { id: loadId },
      select: { shipperCompanyId: true, carrierCompanyId: true, status: true },
    });
    if (!load) throw notFound("Load not found");
    assertCanUploadOperationalDocument(actor, load);

    if (!isWithinOperationalActivityWindow(load.status)) {
      throw conflict(
        "Documents can only be uploaded while the shipment is active (assigned through delivered).",
      );
    }

    if (input.replacedDocumentId !== undefined) {
      await this.assertValidReplacementTarget(loadId, input.replacedDocumentId);
    }

    const documentId = randomUUID();
    const storageKey = operationalDocumentStorageKey(loadId, documentId);

    let upload;
    try {
      upload = await this.storage.createSignedUpload({
        key: storageKey,
        contentType: input.contentType,
        maxBytes: MAX_OPERATIONAL_DOCUMENT_BYTES,
      });
    } catch (err) {
      throw this.toStorageError(err);
    }

    const row = await this.prisma.loadDocument.create({
      data: {
        id: documentId,
        loadId,
        docType: input.documentType,
        uploadedByUserId: actor.userId,
        uploadedByCompanyId: actor.companyId!,
        storageKey,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        originalFilename: input.originalFilename,
        replacesDocumentId: input.replacedDocumentId ?? null,
      },
    });

    return {
      document: toDocumentView(row),
      upload: {
        url: upload.url,
        method: upload.method,
        ...(upload.fields ? { fields: upload.fields } : {}),
        headers: upload.headers,
        expiresAt: upload.expiresAt,
        maxBytes: MAX_OPERATIONAL_DOCUMENT_BYTES,
      },
    };
  }

  /** Stage B. Only the requesting company may confirm. Verifies the object
   *  against the authorized intent (exists, non-empty, actual === declared,
   *  content-type match) before flipping `confirmed_at` — and, for a POD,
   *  `review_status = PENDING_REVIEW`. */
  async confirm(actor: AuthenticatedActor, documentId: string): Promise<DocumentView> {
    const doc = await this.prisma.loadDocument.findUnique({
      where: { id: documentId },
      include: {
        load: { select: { shipperCompanyId: true, carrierCompanyId: true, status: true } },
      },
    });
    if (!doc) throw notFound("Document not found");
    assertCanReadLoad(actor, doc.load);
    if (!isAdmin(actor) && actor.companyId !== doc.uploadedByCompanyId) {
      throw forbidden("Only the company that requested this upload may confirm it.");
    }

    if (doc.removedAt !== null) throw conflict("This document has been removed.");
    if (doc.confirmedAt !== null) {
      // Idempotent — already confirmed. No storage re-inspection, no second event.
      return toDocumentView(doc, await this.singleReview(documentId));
    }
    if (!isWithinOperationalActivityWindow(doc.load.status)) {
      throw conflict(
        "Documents can no longer be confirmed once the shipment is completed or cancelled.",
      );
    }

    let meta;
    try {
      meta = await this.storage.headObject(doc.storageKey);
    } catch (err) {
      throw this.toStorageError(err);
    }
    if (meta === null) {
      throw new AppError(
        409,
        "DOCUMENT_NOT_UPLOADED",
        "The file was not found in storage. Upload it before confirming.",
      );
    }
    if (meta.contentLength <= 0) {
      throw new AppError(409, "DOCUMENT_EMPTY", "The uploaded file is empty.");
    }
    if (meta.contentLength > MAX_OPERATIONAL_DOCUMENT_BYTES) {
      throw new AppError(
        409,
        "DOCUMENT_TOO_LARGE",
        "The uploaded file exceeds the maximum allowed size.",
      );
    }
    // Decision 2 — STRICT EQUALITY. The authorized intent is one exact file;
    // a direct object-storage upload must not transform its bytes.
    if (doc.sizeBytes !== null && meta.contentLength !== doc.sizeBytes) {
      throw new AppError(
        409,
        "DOCUMENT_SIZE_MISMATCH",
        "The uploaded file size does not match the authorized upload request.",
      );
    }
    if (meta.contentType !== null && meta.contentType !== doc.contentType) {
      throw new AppError(
        409,
        "DOCUMENT_CONTENT_TYPE_MISMATCH",
        "The uploaded file type does not match the authorized upload request.",
      );
    }

    const now = new Date();
    const confirmed = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM load_documents WHERE id = ${documentId}::uuid FOR UPDATE`;
      const fresh = await tx.loadDocument.findUniqueOrThrow({
        where: { id: documentId },
        select: { confirmedAt: true, removedAt: true, docType: true },
      });
      if (fresh.removedAt !== null) throw conflict("This document has been removed.");
      if (fresh.confirmedAt !== null) {
        return tx.loadDocument.findUniqueOrThrow({ where: { id: documentId } });
      }
      const updated = await tx.loadDocument.update({
        where: { id: documentId },
        data: {
          confirmedAt: now,
          sizeBytes: meta.contentLength,
          ...(fresh.docType === "POD" ? { reviewStatus: "PENDING_REVIEW" } : {}),
        },
      });
      await appendLoadEvent(
        tx,
        buildDocumentUploadedEvent({
          loadId: doc.loadId,
          actorUserId: actor.userId,
          actorCompanyId: actor.companyId,
          documentId,
          docType: fresh.docType,
        }),
      );
      return updated;
    });

    return toDocumentView(confirmed, await this.singleReview(documentId));
  }

  /** Confirmed, non-removed documents only, chronological. */
  async list(actor: AuthenticatedActor, loadId: string): Promise<DocumentView[]> {
    const load = await this.prisma.load.findUnique({
      where: { id: loadId },
      select: { shipperCompanyId: true, carrierCompanyId: true },
    });
    if (!load) throw notFound("Load not found");
    assertCanReadLoad(actor, load);

    const rows = await this.prisma.loadDocument.findMany({
      where: { loadId, confirmedAt: { not: null }, removedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { reviews: true },
    });
    return rows.map((r) => toDocumentView(r, r.reviews[0] ?? null));
  }

  /** Short-lived signed download for a confirmed, non-removed document whose
   *  object is actually present. Never returns a dead URL. */
  async download(actor: AuthenticatedActor, documentId: string): Promise<DocumentDownloadView> {
    const doc = await this.prisma.loadDocument.findUnique({
      where: { id: documentId },
      include: { load: { select: { shipperCompanyId: true, carrierCompanyId: true } } },
    });
    if (!doc) throw notFound("Document not found");
    assertCanReadLoad(actor, doc.load);
    if (doc.confirmedAt === null || doc.removedAt !== null) {
      throw notFound("Document not found");
    }

    let meta;
    try {
      meta = await this.storage.headObject(doc.storageKey);
    } catch (err) {
      throw this.toStorageError(err);
    }
    if (meta === null) {
      throw new AppError(
        409,
        "DOCUMENT_OBJECT_MISSING",
        "The document file is no longer available in storage.",
      );
    }

    let signed;
    try {
      signed = await this.storage.createSignedDownload(doc.storageKey);
    } catch (err) {
      throw this.toStorageError(err);
    }
    return { url: signed.url, expiresAt: signed.expiresAt };
  }

  // ── helpers ────────────────────────────────────────────────────────

  private singleReview(documentId: string) {
    return this.prisma.documentReview.findUnique({ where: { documentId } });
  }

  /**
   * Correction 9: a `replaces_document_id` reference is valid only when the
   * target is a CONFIRMED, non-removed, REJECTED POD on the SAME load.
   * Everything else — cross-load, BOL/OTHER, unconfirmed, PENDING_REVIEW,
   * APPROVED — is rejected.
   */
  private async assertValidReplacementTarget(
    loadId: string,
    replacedDocumentId: string,
  ): Promise<void> {
    const target = await this.prisma.loadDocument.findUnique({
      where: { id: replacedDocumentId },
      select: {
        loadId: true,
        docType: true,
        confirmedAt: true,
        reviewStatus: true,
        removedAt: true,
      },
    });
    if (
      !target ||
      target.loadId !== loadId ||
      target.docType !== "POD" ||
      target.confirmedAt === null ||
      target.removedAt !== null ||
      target.reviewStatus !== "REJECTED"
    ) {
      throw new AppError(
        400,
        "INVALID_REPLACEMENT_TARGET",
        "The referenced document is not a rejected POD on this load and cannot be replaced.",
      );
    }
  }

  private toStorageError(err: unknown): AppError {
    if (
      err instanceof StorageProviderError &&
      (err.code === "INVALID_KEY" || err.code === "INVALID_REQUEST")
    ) {
      // A server-side bug (the key/policy is server-generated) — surface as 500.
      return new AppError(500, "INTERNAL_ERROR", "An unexpected error occurred");
    }
    return storageUnavailable();
  }
}
