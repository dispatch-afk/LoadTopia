import type { DocumentView } from "@loadtopia/shared";
import { Badge } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import {
  DOCUMENT_TYPE_SHORT,
  POD_REVIEW_LABELS,
  formatFileSize,
  uploaderLabel,
} from "@/lib/operations";
import { DocumentDownloadLink } from "./document-download-link";
import { DocumentRemoveButton } from "./document-remove-button";
import { DocumentUpload } from "./document-upload";
import { PodReviewActions } from "./pod-review-actions";

const REVIEW_TONE: Record<string, "amber" | "green" | "red"> = {
  PENDING_REVIEW: "amber",
  APPROVED: "green",
  REJECTED: "red",
};

/**
 * Operational documents for a load. Shows only what the API returns (confirmed,
 * non-removed). A rejected POD stays visible with its reason; its replacement is
 * a new row that links back to it. POD review controls appear for the owning
 * shipper only; the assigned carrier sees the review state but no controls.
 */
export function DocumentsPanel({
  loadId,
  documents,
  shipperCompanyId,
  activeCompanyId,
  canUpload,
  canReview,
}: {
  loadId: string;
  documents: DocumentView[];
  shipperCompanyId: string;
  activeCompanyId: string | null;
  canUpload: boolean;
  canReview: boolean;
}) {
  const replacedIds = new Set(
    documents.map((d) => d.replacesDocumentId).filter((v): v is string => v !== null),
  );

  return (
    <div className="space-y-5">
      {documents.length === 0 ? (
        <p className="text-sm text-muted">No documents uploaded yet.</p>
      ) : (
        <ul className="space-y-3">
          {documents.map((doc) => {
            const isPod = doc.docType === "POD";
            const reviewed =
              isPod && (doc.reviewStatus === "APPROVED" || doc.reviewStatus === "REJECTED");
            const ownCompany =
              activeCompanyId !== null && doc.uploadedByCompanyId === activeCompanyId;
            const removable = canUpload && ownCompany && !reviewed;
            const hasReplacement = replacedIds.has(doc.id);

            return (
              <li key={doc.id} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                      <Badge tone="gray">{DOCUMENT_TYPE_SHORT[doc.docType]}</Badge>
                      <span className="break-all">{doc.originalFilename ?? "document"}</span>
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {formatFileSize(doc.sizeBytes)} ·{" "}
                      {uploaderLabel(doc.uploadedByCompanyId, shipperCompanyId, activeCompanyId)} ·
                      uploaded {fmtDateTime(doc.confirmedAt)}
                    </p>
                    {doc.replacesDocumentId && (
                      <p className="mt-1 text-xs text-muted">Replacement for a rejected POD.</p>
                    )}
                    {hasReplacement && (
                      <p className="mt-1 text-xs text-muted">
                        A replacement POD was uploaded for this document.
                      </p>
                    )}
                  </div>
                  {isPod && doc.reviewStatus && (
                    <Badge tone={REVIEW_TONE[doc.reviewStatus] ?? "gray"}>
                      {POD_REVIEW_LABELS[doc.reviewStatus] ?? doc.reviewStatus}
                    </Badge>
                  )}
                </div>

                {isPod && doc.reviewStatus === "REJECTED" && doc.reviewReason && (
                  <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
                    Rejected: {doc.reviewReason}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-4">
                  <DocumentDownloadLink documentId={doc.id} />
                  {removable && <DocumentRemoveButton documentId={doc.id} />}
                </div>

                {canReview && isPod && doc.reviewStatus === "PENDING_REVIEW" && (
                  <PodReviewActions documentId={doc.id} />
                )}

                {canUpload && isPod && doc.reviewStatus === "REJECTED" && (
                  <div className="mt-3 border-t border-line pt-3">
                    <DocumentUpload
                      loadId={loadId}
                      fixedDocType="POD"
                      replacedDocumentId={doc.id}
                      label="Upload replacement POD"
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canUpload && (
        <div className="border-t border-line pt-4">
          <h3 className="mb-3 text-sm font-semibold text-ink">Upload a document</h3>
          <DocumentUpload loadId={loadId} />
        </div>
      )}
    </div>
  );
}
