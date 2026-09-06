import { describe, expect, it } from "vitest";
import {
  ALLOWED_DOCUMENT_CONTENT_TYPES,
  documentUploadRequestSchema,
  MAX_OPERATIONAL_DOCUMENT_BYTES,
  rejectPodSchema,
} from "./document";

const base = {
  documentType: "POD" as const,
  originalFilename: "signed-pod.pdf",
  contentType: "application/pdf" as const,
  sizeBytes: 1024,
};

describe("documentUploadRequestSchema", () => {
  it("the max size constant is exactly 25 MiB", () => {
    expect(MAX_OPERATIONAL_DOCUMENT_BYTES).toBe(26_214_400);
    expect(MAX_OPERATIONAL_DOCUMENT_BYTES).toBe(25 * 1024 * 1024);
  });

  it("accepts a well-formed request", () => {
    expect(documentUploadRequestSchema.parse(base)).toMatchObject(base);
  });

  it("allows exactly the three MIME types and nothing else", () => {
    expect([...ALLOWED_DOCUMENT_CONTENT_TYPES].sort()).toEqual(
      ["application/pdf", "image/jpeg", "image/png"].sort(),
    );
    for (const ct of ALLOWED_DOCUMENT_CONTENT_TYPES) {
      expect(documentUploadRequestSchema.parse({ ...base, contentType: ct }).contentType).toBe(ct);
    }
    for (const ct of ["text/html", "application/octet-stream", "image/gif", "image/svg+xml"]) {
      expect(() => documentUploadRequestSchema.parse({ ...base, contentType: ct })).toThrow();
    }
  });

  it("enforces the document-type enum", () => {
    for (const t of ["BOL", "POD", "OTHER"]) {
      expect(documentUploadRequestSchema.parse({ ...base, documentType: t }).documentType).toBe(t);
    }
    expect(() =>
      documentUploadRequestSchema.parse({ ...base, documentType: "RATE_CONFIRMATION" }),
    ).toThrow();
  });

  it("rejects a non-positive or oversized declared size, accepts exactly the max", () => {
    expect(() => documentUploadRequestSchema.parse({ ...base, sizeBytes: 0 })).toThrow();
    expect(() => documentUploadRequestSchema.parse({ ...base, sizeBytes: -1 })).toThrow();
    expect(() => documentUploadRequestSchema.parse({ ...base, sizeBytes: 1.5 })).toThrow();
    expect(() =>
      documentUploadRequestSchema.parse({ ...base, sizeBytes: MAX_OPERATIONAL_DOCUMENT_BYTES + 1 }),
    ).toThrow();
    expect(
      documentUploadRequestSchema.parse({ ...base, sizeBytes: MAX_OPERATIONAL_DOCUMENT_BYTES })
        .sizeBytes,
    ).toBe(MAX_OPERATIONAL_DOCUMENT_BYTES);
  });

  it("bounds and sanitizes the filename (no path separators / control chars / traversal)", () => {
    expect(
      documentUploadRequestSchema.parse({ ...base, originalFilename: "  a.pdf  " })
        .originalFilename,
    ).toBe("a.pdf");
    const bad = ["../etc/passwd", "a/b.pdf", "a\\b.pdf", "..", ".", "x".repeat(256), ""];
    for (const f of bad) {
      expect(
        () => documentUploadRequestSchema.parse({ ...base, originalFilename: f }),
        f,
      ).toThrow();
    }
    // a space is fine in a display name
    expect(
      documentUploadRequestSchema.parse({ ...base, originalFilename: "signed pod.pdf" })
        .originalFilename,
    ).toBe("signed pod.pdf");
  });

  it("rejects unknown fields (server-authoritative metadata)", () => {
    for (const extra of [
      { storageKey: "x" },
      { uploadedByCompanyId: "x" },
      { confirmedAt: "x" },
      { id: "x" },
      { reviewStatus: "APPROVED" },
    ]) {
      expect(
        () => documentUploadRequestSchema.parse({ ...base, ...extra }),
        JSON.stringify(extra),
      ).toThrow();
    }
  });

  it("only a POD may carry replacedDocumentId", () => {
    const uuid = "11111111-1111-1111-1111-111111111111";
    expect(documentUploadRequestSchema.parse({ ...base, replacedDocumentId: uuid })).toMatchObject({
      replacedDocumentId: uuid,
    });
    expect(() =>
      documentUploadRequestSchema.parse({ ...base, documentType: "BOL", replacedDocumentId: uuid }),
    ).toThrow();
    expect(() =>
      documentUploadRequestSchema.parse({ ...base, replacedDocumentId: "not-a-uuid" }),
    ).toThrow();
  });
});

describe("rejectPodSchema", () => {
  it("requires a non-empty trimmed reason, bounded", () => {
    expect(rejectPodSchema.parse({ reason: "  smudged signature  " }).reason).toBe(
      "smudged signature",
    );
    expect(() => rejectPodSchema.parse({})).toThrow();
    expect(() => rejectPodSchema.parse({ reason: "   " })).toThrow();
    expect(() => rejectPodSchema.parse({ reason: "x".repeat(1001) })).toThrow();
    expect(() => rejectPodSchema.parse({ reason: "ok", extra: 1 })).toThrow();
  });
});
