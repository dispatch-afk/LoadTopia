import {
  type DocumentType,
  type DocumentUploadInstructions,
  MAX_OPERATIONAL_DOCUMENT_BYTES,
} from "@loadtopia/shared";
import { ApiError } from "./api-client";

/**
 * Browser side of the two-stage operational-document upload. The backend is the
 * authority for every rule here — this module only mirrors validation for a
 * fast, specific user experience and builds the direct-to-storage request from
 * the signed instructions the API returns.
 */

export const MAX_DOCUMENT_BYTES = MAX_OPERATIONAL_DOCUMENT_BYTES; // 25 MiB = 26,214,400
export const MAX_DOCUMENT_LABEL = "25 MiB (26,214,400 bytes)";

/** MIME allowlist — identical to the API's `ALLOWED_DOCUMENT_CONTENT_TYPES`. */
export const ACCEPTED_DOCUMENT_CONTENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;
export type AcceptedDocumentContentType = (typeof ACCEPTED_DOCUMENT_CONTENT_TYPES)[number];

/** `accept` attribute for the file input. */
export const DOCUMENT_ACCEPT_ATTR = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

export interface SelectedFile {
  name: string;
  type: string;
  size: number;
}

export function isAcceptedContentType(type: string): type is AcceptedDocumentContentType {
  return (ACCEPTED_DOCUMENT_CONTENT_TYPES as readonly string[]).includes(type);
}

/**
 * Client-side pre-validation. Returns a user-facing message when the selection
 * is obviously invalid, or null when it may be sent to Stage A. A `null`/empty
 * message is never returned for a real problem; the backend still re-checks.
 */
export function validateDocumentFile(file: SelectedFile): string | null {
  if (!isAcceptedContentType(file.type)) {
    return "Unsupported file type. Upload a PDF, JPEG, or PNG.";
  }
  if (file.size <= 0) {
    return "That file is empty.";
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return `That file is too large (${formatBytes(file.size)}). The maximum is ${MAX_DOCUMENT_LABEL}.`;
  }
  return null;
}

/** The exact Stage A request body — declared size/type come straight from the
 *  chosen file so confirm's strict equality check can pass. */
export interface UploadRequestBody {
  documentType: DocumentType;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  replacedDocumentId?: string;
}

export function buildUploadRequestBody(
  file: SelectedFile,
  documentType: DocumentType,
  replacedDocumentId?: string,
): UploadRequestBody {
  return {
    documentType,
    originalFilename: file.name,
    contentType: file.type,
    sizeBytes: file.size,
    ...(replacedDocumentId ? { replacedDocumentId } : {}),
  };
}

export interface SignedUploadRequestPlan {
  url: string;
  init: RequestInit;
}

/**
 * Turn the API's signed instructions into the exact `fetch` the browser must
 * make to object storage. Signed fields are submitted verbatim and never
 * mutated; for a presigned POST the file is appended last, in the `file` field
 * the provider expects. The multipart boundary is left to the browser (no
 * Content-Type header is set for POST).
 */
export function buildSignedUploadRequest(
  instructions: DocumentUploadInstructions,
  file: Blob,
): SignedUploadRequestPlan {
  if (instructions.method === "POST") {
    const form = new FormData();
    for (const [key, value] of Object.entries(instructions.fields ?? {})) {
      form.append(key, value);
    }
    form.append("file", file);
    return { url: instructions.url, init: { method: "POST", body: form } };
  }
  return {
    url: instructions.url,
    init: { method: "PUT", headers: { ...instructions.headers }, body: file },
  };
}

/** A storage upload that did not return a 2xx — surfaced as a clean, generic
 *  message (never the provider's raw XML/body). */
export class StorageUploadError extends Error {
  constructor(readonly httpStatus: number) {
    super("The file could not be uploaded to storage.");
    this.name = "StorageUploadError";
  }
}

// --- Error copy -----------------------------------------------------------

/**
 * Map an API failure to a specific, user-actionable message. Internal details
 * (stack traces, provider errors, request ids) are never surfaced.
 */
export function documentErrorMessage(err: unknown): string {
  if (err instanceof StorageUploadError) {
    return "The file upload to storage failed. Check your connection and try again.";
  }
  if (err instanceof ApiError) {
    switch (err.status) {
      case 400:
        return err.message || "That upload request was rejected.";
      case 403:
        return "You are not allowed to do that on this shipment.";
      case 404:
        return "That document or shipment is no longer available.";
      case 409:
        if (err.code === "DOCUMENT_OBJECT_MISSING") {
          return "The document file is no longer in storage. Upload it again.";
        }
        if (err.code === "DOCUMENT_SIZE_MISMATCH" || err.code === "DOCUMENT_CONTENT_TYPE_MISMATCH") {
          return "The uploaded file did not match the upload request. Start the upload again.";
        }
        return err.message || "This changed while you were working. Refresh and try again.";
      case 429:
        return "Too many upload requests. Please try again shortly.";
      case 503:
        return "Document storage is temporarily unavailable. Please try again.";
      default:
        return err.message || "Something went wrong. Please try again.";
    }
  }
  return "Something went wrong. Please try again.";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
