import type {
  ProviderHealth,
  ProviderProvenance,
  PutObjectRequest,
  SignedUploadRequest,
  SignedUploadResult,
  StorageProvider,
  StoredObjectMetadata,
} from "../types";
import { assertSafeObjectKey, StorageProviderError } from "../s3/shared";

export interface FakeStorageProviderOptions {
  name?: string;
  isMock?: boolean;
  ttlSeconds?: number;
}

interface StoredObject {
  body: Uint8Array;
  contentType: string;
  etag: string;
}

/**
 * In-process, deterministic, network-free stand-in for a real
 * {@link StorageProvider}. Built for controlled M3 tests — it actually stores
 * bytes (unlike `MockStorageProvider`), so the two-stage upload/confirm flow,
 * `headObject` verification, deterministic `putObject`, and Rate Confirmation
 * storage can all be exercised end to end without a bucket.
 *
 * Not registered anywhere and never selected by configuration — tests
 * construct it directly and pass it in via the registry's injection point.
 */
export class FakeStorageProvider implements StorageProvider {
  readonly name: string;
  readonly isMock: boolean;
  private readonly ttlSeconds: number;

  private readonly objects = new Map<string, StoredObject>();
  private outage = false;
  private etagSeq = 0;

  /** Every signed-upload request this fake has issued — for tests that assert
   *  the server-chosen key/contentType/maxBytes were used. */
  readonly signedUploads: SignedUploadRequest[] = [];

  constructor(options: FakeStorageProviderOptions = {}) {
    this.name = options.name ?? "fake-storage";
    this.isMock = options.isMock ?? false;
    this.ttlSeconds = options.ttlSeconds ?? 900;
  }

  // --- test controls -------------------------------------------------------

  /** Simulate a post-startup storage outage: every storage call now fails. */
  simulateOutage(on = true): void {
    this.outage = on;
  }

  /** Simulate the browser having completed the upload the signed request
   *  authorized — the byte-level equivalent of the client's POST landing. */
  simulateUpload(key: string, body: Uint8Array, contentType: string): void {
    assertSafeObjectKey(key);
    this.objects.set(key, { body, contentType, etag: this.nextEtag() });
  }

  storedKeys(): string[] {
    return [...this.objects.keys()];
  }

  getStored(key: string): StoredObject | undefined {
    return this.objects.get(key);
  }

  clear(): void {
    this.objects.clear();
    this.signedUploads.length = 0;
    this.outage = false;
  }

  // --- StorageProvider ---------------------------------------------------

  private nextEtag(): string {
    this.etagSeq += 1;
    return `"fake-etag-${this.etagSeq}"`;
  }

  private expiresAt(): string {
    return new Date(Date.now() + this.ttlSeconds * 1000).toISOString();
  }

  private assertUp(code: string): void {
    if (this.outage) {
      throw new StorageProviderError(code, "The object storage request failed");
    }
  }

  private provenance(): ProviderProvenance {
    return { provider: this.name, isMock: this.isMock, retrievedAt: new Date().toISOString() };
  }

  async createSignedUpload(request: SignedUploadRequest): Promise<SignedUploadResult> {
    this.assertUp("SIGN_UPLOAD_FAILED");
    assertSafeObjectKey(request.key);
    if (!Number.isInteger(request.maxBytes) || request.maxBytes <= 0) {
      throw new StorageProviderError("INVALID_REQUEST", "maxBytes must be a positive integer");
    }
    this.signedUploads.push({ ...request });
    return {
      url: `https://fake-storage.test/${encodeURIComponent(this.name)}`,
      method: "POST",
      headers: {},
      fields: {
        key: request.key,
        "Content-Type": request.contentType,
        "x-fake-max-bytes": String(request.maxBytes),
      },
      expiresAt: this.expiresAt(),
      ...this.provenance(),
    };
  }

  async createSignedDownload(
    key: string,
  ): Promise<{ url: string; expiresAt: string } & ProviderProvenance> {
    this.assertUp("SIGN_DOWNLOAD_FAILED");
    assertSafeObjectKey(key);
    return {
      url: `https://fake-storage.test/download/${encodeURIComponent(key)}?sig=fake`,
      expiresAt: this.expiresAt(),
      ...this.provenance(),
    };
  }

  async headObject(key: string): Promise<StoredObjectMetadata | null> {
    this.assertUp("HEAD_OBJECT_FAILED");
    assertSafeObjectKey(key);
    const obj = this.objects.get(key);
    if (!obj) return null;
    return {
      key,
      contentLength: obj.body.byteLength,
      contentType: obj.contentType,
      etag: obj.etag,
    };
  }

  async putObject(request: PutObjectRequest): Promise<{ key: string } & ProviderProvenance> {
    this.assertUp("PUT_OBJECT_FAILED");
    assertSafeObjectKey(request.key);
    // Overwrites the same key — a retry never creates a different identity.
    this.objects.set(request.key, {
      body: request.body,
      contentType: request.contentType,
      etag: this.nextEtag(),
    });
    return { key: request.key, ...this.provenance() };
  }

  async health(): Promise<ProviderHealth> {
    return {
      status: this.outage ? "error" : "ok",
      isMock: this.isMock,
      message: this.outage ? "fake storage: simulated outage" : "fake storage (in-process)",
    };
  }
}
