import type { PrismaClient } from "@loadtopia/db";
import {
  assertCanModifyLoad,
  assertDocumentReviewTransition,
  buildDocumentReviewedEvent,
  isWithinOperationalActivityWindow,
} from "@loadtopia/domain";
import {
  type AuthenticatedActor,
  DocumentReviewStatus,
  type DocumentView,
} from "@loadtopia/shared";
import { AppError, conflict, notFound } from "../../lib/errors";
import { appendLoadEvent } from "../../lib/load-lifecycle";
import { toDocumentView } from "./documents.serializer";

type Decision = "APPROVED" | "REJECTED";

/**
 * POD review (Milestone 3, Rev. 2 §5). Only the OWNING SHIPPER (or admin)
 * reviews a POD — the carrier that uploaded it never can. A decision is
 * terminal for that specific document: `PENDING_REVIEW → {APPROVED, REJECTED}`,
 * with no path back. Correction is a NEW replacement POD, never a mutation of
 * the reviewed row.
 *
 * Concurrency: the `load_documents` row is locked, `review_status` re-read, and
 * required to still be `PENDING_REVIEW`; `document_reviews.document_id UNIQUE`
 * is the DB backstop. A concurrent approve/reject pair yields exactly one
 * terminal `document_reviews` row and one `DOCUMENT_REVIEWED` event.
 */
export class PodReviewService {
  constructor(private readonly prisma: PrismaClient) {}

  approve(actor: AuthenticatedActor, documentId: string): Promise<DocumentView> {
    return this.review(actor, documentId, "APPROVED", null);
  }

  reject(actor: AuthenticatedActor, documentId: string, reason: string): Promise<DocumentView> {
    return this.review(actor, documentId, "REJECTED", reason);
  }

  private async review(
    actor: AuthenticatedActor,
    documentId: string,
    decision: Decision,
    reason: string | null,
  ): Promise<DocumentView> {
    const doc = await this.prisma.loadDocument.findUnique({
      where: { id: documentId },
      include: {
        load: { select: { shipperCompanyId: true, carrierCompanyId: true, status: true } },
      },
    });
    if (!doc) throw notFound("Document not found");
    // 404 for anyone outside the load's scope; 403 for the assigned carrier
    // (canModifyLoad is shipper-only + admin — the carrier can never review).
    assertCanModifyLoad(actor, doc.load);

    if (!isWithinOperationalActivityWindow(doc.load.status)) {
      throw conflict("POD review is frozen once the shipment is completed or cancelled.");
    }
    this.assertReviewableShape(doc);

    const updated = await this.prisma
      .$transaction(async (tx) => {
        await tx.$executeRaw`SELECT 1 FROM load_documents WHERE id = ${documentId}::uuid FOR UPDATE`;
        const fresh = await tx.loadDocument.findUniqueOrThrow({
          where: { id: documentId },
          select: { docType: true, confirmedAt: true, removedAt: true, reviewStatus: true },
        });
        this.assertReviewableShape(fresh);
        assertDocumentReviewTransition(
          fresh.reviewStatus as DocumentReviewStatus,
          decision as DocumentReviewStatus,
        );

        await tx.documentReview.create({
          data: {
            documentId,
            reviewerUserId: actor.userId,
            reviewerCompanyId: actor.companyId!,
            decision,
            reason,
          },
        });
        const done = await tx.loadDocument.updateMany({
          where: { id: documentId, reviewStatus: DocumentReviewStatus.PENDING_REVIEW },
          data: { reviewStatus: decision },
        });
        if (done.count === 0) {
          throw conflict("This POD has already been reviewed.");
        }
        await appendLoadEvent(
          tx,
          buildDocumentReviewedEvent({
            loadId: doc.loadId,
            actorUserId: actor.userId,
            actorCompanyId: actor.companyId,
            documentId,
            decision,
            reason,
          }),
        );
        return tx.loadDocument.findUniqueOrThrow({ where: { id: documentId } });
      })
      .catch((err: unknown) => {
        // `document_reviews.document_id` UNIQUE — a concurrent decision already won.
        if ((err as { code?: string }).code === "P2002") {
          throw conflict("This POD has already been reviewed.");
        }
        throw err;
      });

    return toDocumentView(
      updated,
      await this.prisma.documentReview.findUnique({ where: { documentId } }),
    );
  }

  private assertReviewableShape(doc: {
    docType: string;
    confirmedAt: Date | null;
    removedAt: Date | null;
    reviewStatus: string | null;
  }): void {
    if (doc.docType !== "POD") {
      throw new AppError(409, "DOCUMENT_NOT_REVIEWABLE", "Only a POD document can be reviewed.");
    }
    if (doc.confirmedAt === null) {
      throw new AppError(
        409,
        "DOCUMENT_NOT_CONFIRMED",
        "This POD upload has not been confirmed and cannot be reviewed.",
      );
    }
    if (doc.removedAt !== null) {
      throw conflict("This document has been removed.");
    }
    if (doc.reviewStatus !== DocumentReviewStatus.PENDING_REVIEW) {
      throw conflict("This POD has already been reviewed.");
    }
  }
}
