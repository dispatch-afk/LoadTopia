"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import type { DocumentType, DocumentUploadRequestView } from "@loadtopia/shared";
import { apiClient } from "@/lib/api-client";
import { Alert, Select, Spinner } from "@/components/ui";
import {
  DOCUMENT_ACCEPT_ATTR,
  MAX_DOCUMENT_LABEL,
  StorageUploadError,
  buildSignedUploadRequest,
  buildUploadRequestBody,
  documentErrorMessage,
  validateDocumentFile,
} from "@/lib/document-upload";
import { DOCUMENT_TYPE_LABELS } from "@/lib/operations";

type Phase = "idle" | "preparing" | "uploading" | "confirming";

const PHASE_LABEL: Record<Exclude<Phase, "idle">, string> = {
  preparing: "Preparing upload…",
  uploading: "Uploading…",
  confirming: "Confirming…",
};

/**
 * Two-stage operational-document upload, entirely client-driven:
 *   1. POST /api/loads/:id/documents            → signed instructions
 *   2. the browser uploads the bytes DIRECTLY to storage using those
 *      instructions verbatim (no proxy through Next)
 *   3. POST /api/load-documents/:id/confirm     → only after step 2 succeeds
 * The document is presented as available only once confirm returns.
 */
export function DocumentUpload({
  loadId,
  fixedDocType,
  replacedDocumentId,
  label,
}: {
  loadId: string;
  fixedDocType?: DocumentType;
  replacedDocumentId?: string;
  label?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const selectId = useId();
  const [docType, setDocType] = useState<DocumentType>(fixedDocType ?? "BOL");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const busy = phase !== "idle";

  async function onFile(file: File) {
    setError(null);
    const clientError = validateDocumentFile(file);
    if (clientError) {
      setError(clientError);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    try {
      setPhase("preparing");
      const { document, upload } = await apiClient<DocumentUploadRequestView>(
        `/loads/${loadId}/documents`,
        {
          method: "POST",
          body: JSON.stringify(buildUploadRequestBody(file, docType, replacedDocumentId)),
        },
      );

      setPhase("uploading");
      const { url, init } = buildSignedUploadRequest(upload, file);
      const storageRes = await fetch(url, init);
      if (!storageRes.ok) {
        // The bytes never landed — do NOT confirm.
        throw new StorageUploadError(storageRes.status);
      }

      setPhase("confirming");
      await apiClient(`/load-documents/${document.id}/confirm`, { method: "POST" });

      setPhase("idle");
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (err) {
      setPhase("idle");
      setError(documentErrorMessage(err));
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-3">
      {error && <Alert>{error}</Alert>}

      {!fixedDocType && (
        <div>
          <label htmlFor={selectId} className="mb-1 block text-sm font-medium text-ink">
            Document type
          </label>
          <Select
            id={selectId}
            value={docType}
            disabled={busy}
            onChange={(e) => setDocType(e.target.value as DocumentType)}
          >
            {(["BOL", "POD", "OTHER"] as DocumentType[]).map((t) => (
              <option key={t} value={t}>
                {DOCUMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept={DOCUMENT_ACCEPT_ATTR}
          disabled={busy}
          aria-label={label ?? "Choose a document to upload"}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFile(file);
          }}
          className="lt-focus block max-w-full text-sm text-ink file:mr-3 file:rounded-lg file:border file:border-line file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-brand-50 disabled:opacity-50"
        />
        {busy && (
          <span className="inline-flex items-center gap-2 text-sm text-muted">
            <Spinner /> {PHASE_LABEL[phase as Exclude<Phase, "idle">]}
          </span>
        )}
      </div>

      <p className="text-xs text-muted">
        {label ? `${label}. ` : ""}PDF, JPEG or PNG, up to {MAX_DOCUMENT_LABEL}.
      </p>
    </div>
  );
}
