import { describe, expect, it } from "vitest";
import {
  assertSafeObjectKey,
  resolveS3StorageConfig,
  sanitizeStorageError,
  StorageProviderError,
} from "./shared";

const CONFIG = {
  region: "us-east-1",
  bucket: "loadtopia-docs",
  accessKeyId: "AKIA_TEST",
  secretAccessKey: "secret_test",
};

describe("assertSafeObjectKey", () => {
  it("accepts the legitimate structured keys M3 generates", () => {
    expect(() =>
      assertSafeObjectKey("rate-confirmations/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.pdf"),
    ).not.toThrow();
    expect(() =>
      assertSafeObjectKey("loads/33333333-3333-3333-3333-333333333333/documents/44444444-4444-4444-4444-444444444444"),
    ).not.toThrow();
  });

  it("rejects an empty key", () => {
    expect(() => assertSafeObjectKey("")).toThrow(StorageProviderError);
  });

  it("rejects a leading slash", () => {
    expect(() => assertSafeObjectKey("/loads/x/y")).toThrow(/start or end with a slash/);
  });

  it("rejects a trailing slash", () => {
    expect(() => assertSafeObjectKey("loads/x/y/")).toThrow(/start or end with a slash/);
  });

  it("rejects a `..` path segment", () => {
    expect(() => assertSafeObjectKey("loads/../secrets/key")).toThrow(/empty or relative segment/);
  });

  it("rejects a `.` path segment", () => {
    expect(() => assertSafeObjectKey("loads/./x")).toThrow(/empty or relative segment/);
  });

  it("rejects an empty segment (double slash)", () => {
    expect(() => assertSafeObjectKey("loads//x")).toThrow(/empty or relative segment/);
  });

  it("rejects a backslash", () => {
    expect(() => assertSafeObjectKey("loads\\x\\y")).toThrow(/backslash/);
  });

  it("rejects control characters", () => {
    expect(() => assertSafeObjectKey(`loads/${String.fromCharCode(0)}/y`)).toThrow(
      /control characters/,
    );
    expect(() => assertSafeObjectKey(`loads/${String.fromCharCode(31)}/y`)).toThrow(
      /control characters/,
    );
    expect(() => assertSafeObjectKey(`loads/${String.fromCharCode(127)}/y`)).toThrow(
      /control characters/,
    );
  });

  it("rejects an unsupported character (space, colon, etc.)", () => {
    expect(() => assertSafeObjectKey("loads/a b/y")).toThrow(/unsupported character/);
    expect(() => assertSafeObjectKey("loads/a:b/y")).toThrow(/unsupported character/);
  });

  it("rejects an excessively long key", () => {
    expect(() => assertSafeObjectKey("a/".repeat(600) + "b")).toThrow(/too long/);
  });
});

describe("resolveS3StorageConfig", () => {
  it("returns a complete config when all required values are present", () => {
    const cfg = resolveS3StorageConfig(CONFIG);
    expect(cfg.bucket).toBe("loadtopia-docs");
    expect(cfg.forcePathStyle).toBe(false);
    expect(cfg.signedUrlTtlSeconds).toBe(900);
  });

  it("throws, naming every missing variable, when required config is absent", () => {
    expect(() => resolveS3StorageConfig({})).toThrow(
      /STORAGE_S3_REGION.*STORAGE_S3_BUCKET.*STORAGE_S3_ACCESS_KEY_ID.*STORAGE_S3_SECRET_ACCESS_KEY/,
    );
  });

  it("throws on a partially-missing config", () => {
    expect(() => resolveS3StorageConfig({ region: "us-east-1", bucket: "b" })).toThrow(
      /STORAGE_S3_ACCESS_KEY_ID, STORAGE_S3_SECRET_ACCESS_KEY/,
    );
  });

  it("rejects a TTL outside [60, 3600]", () => {
    expect(() => resolveS3StorageConfig({ ...CONFIG, signedUrlTtlSeconds: 30 })).toThrow(/between 60 and 3600/);
    expect(() => resolveS3StorageConfig({ ...CONFIG, signedUrlTtlSeconds: 99999 })).toThrow(
      /between 60 and 3600/,
    );
    expect(() => resolveS3StorageConfig({ ...CONFIG, signedUrlTtlSeconds: 0 })).toThrow(
      /between 60 and 3600/,
    );
  });

  it("rejects a non-URL endpoint", () => {
    expect(() => resolveS3StorageConfig({ ...CONFIG, endpoint: "not a url" })).toThrow(/not a valid URL/);
  });

  it("accepts a valid custom endpoint for S3-compatible services", () => {
    const cfg = resolveS3StorageConfig({ ...CONFIG, endpoint: "https://minio.local:9000", forcePathStyle: true });
    expect(cfg.endpoint).toBe("https://minio.local:9000");
    expect(cfg.forcePathStyle).toBe(true);
  });

  it("never places secret values into the thrown error message", () => {
    try {
      resolveS3StorageConfig({ region: "r", bucket: "b", accessKeyId: "AKIA_SUPER_SECRET" });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as Error).message).not.toContain("AKIA_SUPER_SECRET");
    }
  });
});

describe("sanitizeStorageError", () => {
  it("passes a StorageProviderError through unchanged", () => {
    const e = new StorageProviderError("INVALID_KEY", "bad key");
    expect(sanitizeStorageError(e)).toBe(e);
  });

  it("maps a timeout/abort to a TIMEOUT code with no internal detail", () => {
    const e = sanitizeStorageError(Object.assign(new Error("socket hang up on bucket X at 10.0.0.1"), { name: "TimeoutError" }));
    expect(e.code).toBe("TIMEOUT");
    expect(e.message).not.toContain("bucket X");
    expect(e.message).not.toContain("10.0.0.1");
  });

  it("maps an arbitrary AWS SDK error to a generic sanitized failure", () => {
    const awsErr = Object.assign(new Error("AccessDenied: arn:aws:s3:::secret-bucket/key not authorized for AKIA123"), {
      name: "AccessDenied",
      $metadata: { httpStatusCode: 403 },
    });
    const e = sanitizeStorageError(awsErr, "PUT_OBJECT_FAILED");
    expect(e.code).toBe("PUT_OBJECT_FAILED");
    expect(e.message).toBe("The object storage request failed");
    expect(e.message).not.toContain("secret-bucket");
    expect(e.message).not.toContain("AKIA123");
  });
});
