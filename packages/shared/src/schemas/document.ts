import { z } from "zod";

/**
 * Operational document constraints (Milestone 3, Rev. 2 + Slice 6 decisions).
 *
 * Max size is 25 MiB — the exact binary value, not a rounded "25 MB". Enforced
 * at BOTH the upload-request API layer (declared `sizeBytes`) and, for the real
 * provider, the presigned-POST `content-length-range` policy. Confirmation then
 * requires the stored object's actual `ContentLength` to EXACTLY equal the
 * declared size (Decision 2 — strict equality, no tolerance).
 */
export const MAX_OPERATIONAL_DOCUMENT_BYTES = 26_214_400; // 25 * 1024 * 1024

/** True if the string contains an ASCII control character (U+0000–U+001F) or
 *  DEL (U+007F). Checked by code point so this source stays pure ASCII. */
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
}

const filenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (v) => !v.includes("/") && !v.includes("\\") && v !== "." && v !== ".." && !hasControlChar(v),
    "filename must not contain path separators or control characters",
  );

const documentUploadRequestObject = z
  .object({
    documentType: z.enum(["BOL", "POD", "OTHER"]),
    originalFilename: filenameSchema,
    // MIME allowlist — the filename extension is never trusted as MIME truth.
    contentType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
    // Client-declared byte size. `.positive()` enforces > 0.
    sizeBytes: z.number().int().positive().max(MAX_OPERATIONAL_DOCUMENT_BYTES),
    // Only meaningful for a corrected POD re-upload after a REJECTED review.
    replacedDocumentId: z.string().uuid().optional(),
  })
  .strict();

export const documentUploadRequestSchema = documentUploadRequestObject.refine(
  (v) => v.replacedDocumentId === undefined || v.documentType === "POD",
  { message: "only a POD upload may reference a replaced document", path: ["replacedDocumentId"] },
);
export type DocumentUploadRequestInput = z.infer<typeof documentUploadRequestSchema>;

/** The MIME types an operational document may be. Derived from the schema so
 *  the allowlist has exactly one source of truth. */
export const ALLOWED_DOCUMENT_CONTENT_TYPES = documentUploadRequestObject.shape.contentType.options;

export const rejectPodSchema = z
  .object({
    // Required at the API layer iff the decision is REJECTED (Rev. 2 §3).
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
export type RejectPodInput = z.infer<typeof rejectPodSchema>;
