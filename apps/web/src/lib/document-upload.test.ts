import { describe, expect, it } from "vitest";
import type { DocumentUploadInstructions } from "@loadtopia/shared";
import { ApiError } from "./api-client";
import {
  MAX_DOCUMENT_BYTES,
  StorageUploadError,
  buildSignedUploadRequest,
  buildUploadRequestBody,
  documentErrorMessage,
  validateDocumentFile,
} from "./document-upload";

describe("MAX_DOCUMENT_BYTES", () => {
  it("is exactly 25 MiB", () => {
    expect(MAX_DOCUMENT_BYTES).toBe(26_214_400);
    expect(MAX_DOCUMENT_BYTES).toBe(25 * 1024 * 1024);
  });
});

describe("validateDocumentFile (brief items 32-36)", () => {
  const at = (type: string, size = 1024) => ({ name: "f", type, size });

  it("accepts PDF, JPEG, PNG", () => {
    expect(validateDocumentFile(at("application/pdf"))).toBeNull();
    expect(validateDocumentFile(at("image/jpeg"))).toBeNull();
    expect(validateDocumentFile(at("image/png"))).toBeNull();
  });

  it("rejects an unsupported MIME type", () => {
    expect(validateDocumentFile(at("image/gif"))).toMatch(/unsupported/i);
    expect(validateDocumentFile(at(""))).toMatch(/unsupported/i);
    expect(validateDocumentFile(at("application/octet-stream"))).toMatch(/unsupported/i);
  });

  it("rejects an empty file", () => {
    expect(validateDocumentFile(at("application/pdf", 0))).toMatch(/empty/i);
  });

  it("accepts exactly 25 MiB and rejects one byte over", () => {
    expect(validateDocumentFile(at("application/pdf", MAX_DOCUMENT_BYTES))).toBeNull();
    expect(validateDocumentFile(at("application/pdf", MAX_DOCUMENT_BYTES + 1))).toMatch(/too large/i);
  });
});

describe("buildUploadRequestBody (brief item 37 — exact declared size/type)", () => {
  it("declares the chosen file's exact size and content type", () => {
    const file = { name: "delivery-receipt.pdf", type: "application/pdf", size: 918_273 };
    expect(buildUploadRequestBody(file, "POD")).toEqual({
      documentType: "POD",
      originalFilename: "delivery-receipt.pdf",
      contentType: "application/pdf",
      sizeBytes: 918_273,
    });
  });

  it("includes replacedDocumentId only for a replacement", () => {
    const file = { name: "pod.jpg", type: "image/jpeg", size: 5000 };
    expect(buildUploadRequestBody(file, "POD", "doc-rejected-1")).toMatchObject({
      replacedDocumentId: "doc-rejected-1",
    });
    expect(buildUploadRequestBody(file, "POD")).not.toHaveProperty("replacedDocumentId");
  });
});

describe("buildSignedUploadRequest (brief item 38 — uses backend instructions verbatim)", () => {
  const file = new Blob(["hello"], { type: "application/pdf" });

  it("presigned POST: every signed field, then the file last, no Content-Type header", () => {
    const instructions: DocumentUploadInstructions = {
      url: "https://storage.example/bucket",
      method: "POST",
      fields: { key: "loads/L/documents/D", "Content-Type": "application/pdf", policy: "abc", "x-amz-signature": "sig" },
      headers: {},
      expiresAt: "2026-09-07T00:15:00.000Z",
      maxBytes: MAX_DOCUMENT_BYTES,
    };
    const { url, init } = buildSignedUploadRequest(instructions, file);
    expect(url).toBe("https://storage.example/bucket");
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect(form.get("key")).toBe("loads/L/documents/D");
    expect(form.get("policy")).toBe("abc");
    expect(form.get("x-amz-signature")).toBe("sig");
    expect(form.get("Content-Type")).toBe("application/pdf");
    expect(form.get("file")).toBeInstanceOf(Blob);
    // file field must be last so a presigned POST policy accepts it
    expect([...form.keys()].at(-1)).toBe("file");
    expect(init.headers).toBeUndefined();
  });

  it("presigned PUT: file is the body, signed headers passed through", () => {
    const instructions: DocumentUploadInstructions = {
      url: "https://storage.example/bucket/loads/L/documents/D",
      method: "PUT",
      headers: { "content-type": "image/png" },
      expiresAt: "2026-09-07T00:15:00.000Z",
      maxBytes: MAX_DOCUMENT_BYTES,
    };
    const { url, init } = buildSignedUploadRequest(instructions, file);
    expect(url).toBe("https://storage.example/bucket/loads/L/documents/D");
    expect(init.method).toBe("PUT");
    expect(init.headers).toEqual({ "content-type": "image/png" });
    expect(init.body).toBe(file);
  });
});

describe("documentErrorMessage (brief items 44-45 — clean, specific copy)", () => {
  it("429 -> upload limit message", () => {
    expect(documentErrorMessage(new ApiError(429, "RATE_LIMITED", "x"))).toMatch(
      /too many upload requests/i,
    );
  });
  it("503 -> storage unavailable message", () => {
    expect(documentErrorMessage(new ApiError(503, "STORAGE_UNAVAILABLE", "x"))).toMatch(
      /storage is temporarily unavailable/i,
    );
  });
  it("409 DOCUMENT_OBJECT_MISSING -> re-upload guidance", () => {
    expect(documentErrorMessage(new ApiError(409, "DOCUMENT_OBJECT_MISSING", "x"))).toMatch(
      /no longer in storage/i,
    );
  });
  it("storage upload failure -> generic, no provider body", () => {
    const msg = documentErrorMessage(new StorageUploadError(403));
    expect(msg).toMatch(/upload to storage failed/i);
    expect(msg).not.toMatch(/403/);
  });
  it("unknown error -> generic message, never a stack trace", () => {
    expect(documentErrorMessage(new Error("ECONNRESET at internal:foo"))).toBe(
      "Something went wrong. Please try again.",
    );
  });
});
