import type { DocumentReview, LoadDocument } from "@loadtopia/db";
import type { DocumentStatus, DocumentView } from "@loadtopia/shared";

function deriveStatus(d: LoadDocument): DocumentStatus {
  if (d.removedAt !== null) return "REMOVED";
  if (d.confirmedAt !== null) return "CONFIRMED";
  return "PENDING";
}

/**
 * Serialize a `load_documents` row to metadata only — the file bytes are never
 * inlined and the storage key is never exposed. `review` is the single (unique)
 * `document_reviews` row when one exists, used only to surface a REJECTED
 * reason.
 */
export function toDocumentView(d: LoadDocument, review?: DocumentReview | null): DocumentView {
  return {
    id: d.id,
    loadId: d.loadId,
    docType: d.docType,
    status: deriveStatus(d),
    contentType: d.contentType,
    sizeBytes: d.sizeBytes,
    originalFilename: d.originalFilename,
    reviewStatus: d.reviewStatus,
    reviewReason: review && review.decision === "REJECTED" ? (review.reason ?? null) : null,
    replacesDocumentId: d.replacesDocumentId,
    uploadedByUserId: d.uploadedByUserId,
    uploadedByCompanyId: d.uploadedByCompanyId,
    confirmedAt: d.confirmedAt?.toISOString() ?? null,
    removedAt: d.removedAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}
