/**
 * Shared plumbing for the S3-compatible StorageProvider. Framework-free, no
 * dependency on `apps/api` — matches the rest of this package.
 *
 * Nothing here ever surfaces a bucket name, credential, endpoint, or raw AWS
 * SDK error/stack to an API consumer: {@link sanitizeStorageError} maps every
 * failure to a stable machine code and a safe message.
 */

/** Stable, typed failure from the storage layer. Carries no credential,
 *  bucket name, endpoint, or AWS SDK internals — only a machine code and a
 *  safe message. */
export class StorageProviderError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "StorageProviderError";
    this.code = code;
  }
}

const MAX_KEY_LENGTH = 1024;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** ASCII control characters (U+0000–U+001F) and DEL (U+007F). Checked by code
 *  point so this source file stays pure ASCII. */
function hasControlCharacter(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
}

/**
 * Object-key hygiene. Keys are ALWAYS server-generated (the service layer
 * builds `loads/{uuid}/documents/{uuid}` or `rate-confirmations/{uuid}/{uuid}.pdf`
 * before calling the provider) — this is defence-in-depth against a bug that
 * lets a caller-controlled value through, and against path traversal in the
 * underlying store.
 *
 * Rules: non-empty, <= 1024 chars, only `[A-Za-z0-9._-]` within a segment,
 * segments joined by a single `/`, no leading/trailing slash, no empty
 * segment, no `.` or `..` segment, no backslash, no control characters.
 */
export function assertSafeObjectKey(key: string): void {
  if (typeof key !== "string" || key.length === 0) {
    throw new StorageProviderError("INVALID_KEY", "Object key must be a non-empty string");
  }
  if (key.length > MAX_KEY_LENGTH) {
    throw new StorageProviderError("INVALID_KEY", "Object key is too long");
  }
  if (hasControlCharacter(key)) {
    throw new StorageProviderError("INVALID_KEY", "Object key contains control characters");
  }
  if (key.includes("\\")) {
    throw new StorageProviderError("INVALID_KEY", "Object key contains a backslash");
  }
  if (key.startsWith("/") || key.endsWith("/")) {
    throw new StorageProviderError("INVALID_KEY", "Object key must not start or end with a slash");
  }
  for (const seg of key.split("/")) {
    if (seg === "" || seg === "." || seg === "..") {
      throw new StorageProviderError(
        "INVALID_KEY",
        "Object key contains an empty or relative segment",
      );
    }
    if (!SEGMENT.test(seg)) {
      throw new StorageProviderError("INVALID_KEY", "Object key contains an unsupported character");
    }
  }
}

/** Map any thrown value to a safe, typed error. Never re-exposes bucket names,
 *  endpoints, credentials, or AWS SDK stack details. */
export function sanitizeStorageError(
  err: unknown,
  fallbackCode = "STORAGE_ERROR",
): StorageProviderError {
  if (err instanceof StorageProviderError) return err;
  const name = (err as { name?: string })?.name;
  if (name === "TimeoutError" || name === "AbortError") {
    return new StorageProviderError("TIMEOUT", "The object storage request timed out");
  }
  return new StorageProviderError(fallbackCode, "The object storage request failed");
}

export interface S3StorageConfig {
  /** Optional custom endpoint for S3-compatible services (MinIO, R2, Spaces).
   *  Omit for AWS S3 itself. */
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Required for most S3-compatible services (MinIO, some R2 setups). */
  forcePathStyle: boolean;
  /** Signed-URL / presigned-POST lifetime, in seconds. */
  signedUrlTtlSeconds: number;
}

export interface PartialS3StorageConfig {
  endpoint?: string;
  region?: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  signedUrlTtlSeconds?: number;
}

const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 3600;
const DEFAULT_TTL_SECONDS = 900; // 15 minutes

/**
 * Resolve and validate the S3 config at boot. Throws loudly — mirroring
 * `resolveApiKey` for the Google providers — so selecting `STORAGE_PROVIDER=s3`
 * with missing or invalid configuration fails process startup rather than
 * silently degrading. There is deliberately no fallback to MockStorageProvider.
 */
export function resolveS3StorageConfig(partial: PartialS3StorageConfig): S3StorageConfig {
  const missing: string[] = [];
  if (!partial.region) missing.push("STORAGE_S3_REGION");
  if (!partial.bucket) missing.push("STORAGE_S3_BUCKET");
  if (!partial.accessKeyId) missing.push("STORAGE_S3_ACCESS_KEY_ID");
  if (!partial.secretAccessKey) missing.push("STORAGE_S3_SECRET_ACCESS_KEY");
  if (missing.length > 0) {
    throw new Error(
      `S3 storage provider selected (STORAGE_PROVIDER=s3) but required configuration is missing: ${missing.join(", ")}.`,
    );
  }

  const ttl = partial.signedUrlTtlSeconds ?? DEFAULT_TTL_SECONDS;
  if (!Number.isFinite(ttl) || ttl < MIN_TTL_SECONDS || ttl > MAX_TTL_SECONDS) {
    throw new Error(
      `STORAGE_SIGNED_URL_TTL_SECONDS must be between ${MIN_TTL_SECONDS} and ${MAX_TTL_SECONDS}; got ${String(
        partial.signedUrlTtlSeconds,
      )}.`,
    );
  }

  if (partial.endpoint !== undefined) {
    try {
      new URL(partial.endpoint);
    } catch {
      throw new Error("STORAGE_S3_ENDPOINT is not a valid URL.");
    }
  }

  return {
    endpoint: partial.endpoint,
    region: partial.region!,
    bucket: partial.bucket!,
    accessKeyId: partial.accessKeyId!,
    secretAccessKey: partial.secretAccessKey!,
    forcePathStyle: partial.forcePathStyle ?? false,
    signedUrlTtlSeconds: ttl,
  };
}
