import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  ProviderHealth,
  ProviderProvenance,
  PutObjectRequest,
  SignedUploadRequest,
  SignedUploadResult,
  StorageProvider,
  StoredObjectMetadata,
} from "../types";
import {
  assertSafeObjectKey,
  type S3StorageConfig,
  sanitizeStorageError,
  StorageProviderError,
} from "./shared";

export interface S3StorageProviderOptions {
  /** Injectable for tests — never a live client in a unit test. Defaults to a
   *  real `S3Client` built from the config. */
  client?: S3Client;
}

function provenance(): ProviderProvenance {
  return { provider: "s3", isMock: false, retrievedAt: new Date().toISOString() };
}

/**
 * Real, private, S3-compatible object storage (AWS S3, Cloudflare R2, MinIO,
 * DigitalOcean Spaces, …). The persistent credentials live only in this
 * process; every consumer-facing access is a short-lived signed URL or a
 * server-side write.
 *
 * Uploads use a **presigned POST** — the only mechanism that genuinely
 * enforces `content-length-range` and an exact `Content-Type` at the storage
 * layer. `createSignedUpload` returns `method: "POST"` plus `fields` the
 * browser must submit verbatim; a presigned PUT is deliberately not used
 * because it cannot enforce a maximum size.
 */
export class S3StorageProvider implements StorageProvider {
  readonly name = "s3";
  readonly isMock = false;

  private readonly client: S3Client;

  constructor(
    private readonly config: S3StorageConfig,
    options: S3StorageProviderOptions = {},
  ) {
    this.client =
      options.client ??
      new S3Client({
        region: config.region,
        ...(config.endpoint ? { endpoint: config.endpoint } : {}),
        forcePathStyle: config.forcePathStyle,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      });
  }

  private expiresAt(): string {
    return new Date(Date.now() + this.config.signedUrlTtlSeconds * 1000).toISOString();
  }

  async createSignedUpload(request: SignedUploadRequest): Promise<SignedUploadResult> {
    assertSafeObjectKey(request.key);
    if (!Number.isInteger(request.maxBytes) || request.maxBytes <= 0) {
      throw new StorageProviderError("INVALID_REQUEST", "maxBytes must be a positive integer");
    }
    if (!request.contentType) {
      throw new StorageProviderError("INVALID_REQUEST", "contentType is required");
    }

    try {
      const { url, fields } = await createPresignedPost(this.client, {
        Bucket: this.config.bucket,
        Key: request.key,
        Expires: this.config.signedUrlTtlSeconds,
        // Storage-layer enforcement: the object must be <= maxBytes and its
        // Content-Type must match exactly. A client that submits anything
        // else is rejected by the store, not just by our API.
        Conditions: [
          ["content-length-range", 1, request.maxBytes],
          { "Content-Type": request.contentType },
        ],
        Fields: { "Content-Type": request.contentType },
      });
      return {
        url,
        method: "POST",
        headers: {},
        fields,
        expiresAt: this.expiresAt(),
        ...provenance(),
      };
    } catch (err) {
      throw sanitizeStorageError(err, "SIGN_UPLOAD_FAILED");
    }
  }

  async createSignedDownload(
    key: string,
  ): Promise<{ url: string; expiresAt: string } & ProviderProvenance> {
    assertSafeObjectKey(key);
    try {
      const url = await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
        { expiresIn: this.config.signedUrlTtlSeconds },
      );
      return { url, expiresAt: this.expiresAt(), ...provenance() };
    } catch (err) {
      throw sanitizeStorageError(err, "SIGN_DOWNLOAD_FAILED");
    }
  }

  async headObject(key: string): Promise<StoredObjectMetadata | null> {
    assertSafeObjectKey(key);
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return {
        key,
        contentLength: res.ContentLength ?? 0,
        contentType: res.ContentType ?? null,
        ...(res.ETag ? { etag: res.ETag } : {}),
      };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      const name = (err as { name?: string })?.name;
      if (status === 404 || name === "NotFound" || name === "NoSuchKey") {
        return null;
      }
      throw sanitizeStorageError(err, "HEAD_OBJECT_FAILED");
    }
  }

  async putObject(request: PutObjectRequest): Promise<{ key: string } & ProviderProvenance> {
    assertSafeObjectKey(request.key);
    if (!request.contentType) {
      throw new StorageProviderError("INVALID_REQUEST", "contentType is required");
    }
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: request.key,
          Body: request.body,
          ContentType: request.contentType,
        }),
      );
      // Same deterministic key in, same key out — a retry overwrites the same
      // object; no new identity is ever created here.
      return { key: request.key, ...provenance() };
    } catch (err) {
      throw sanitizeStorageError(err, "PUT_OBJECT_FAILED");
    }
  }

  async health(): Promise<ProviderHealth> {
    // The constructor + resolveS3StorageConfig already guarantee a complete,
    // valid configuration. A live HeadBucket here would add a network call to
    // every /api/health hit; consistent with the Google adapters, health is
    // static. A storage outage surfaces on the storage-dependent call itself.
    return {
      status: "ok",
      isMock: false,
      message: "S3-compatible object storage (configured, private bucket)",
    };
  }
}
