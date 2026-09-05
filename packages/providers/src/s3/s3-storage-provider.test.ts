import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { S3StorageProvider } from "./s3-storage-provider";
import type { S3StorageConfig } from "./shared";
import { StorageProviderError } from "./shared";

const CONFIG: S3StorageConfig = {
  region: "us-east-1",
  bucket: "loadtopia-docs",
  accessKeyId: "AKIA_TEST",
  secretAccessKey: "secret_test_value",
  forcePathStyle: false,
  signedUrlTtlSeconds: 900,
};

const KEY = "rate-confirmations/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.pdf";

/** A real S3Client (constructing one does no I/O) whose `send` is stubbed —
 *  so presigning runs for real against dummy creds while HEAD/PUT never touch
 *  the network. */
function providerWithStubbedSend() {
  const client = new S3Client({
    region: CONFIG.region,
    credentials: { accessKeyId: CONFIG.accessKeyId, secretAccessKey: CONFIG.secretAccessKey },
  });
  const send = vi.spyOn(client, "send");
  const provider = new S3StorageProvider(CONFIG, { client });
  return { provider, send, client };
}

describe("S3StorageProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("createSignedUpload returns a presigned POST with server-provided key, bounded expiry, and enforcement fields", async () => {
    const { provider } = providerWithStubbedSend();
    const res = await provider.createSignedUpload({
      key: KEY,
      contentType: "application/pdf",
      maxBytes: 10 * 1024 * 1024,
    });

    expect(res.method).toBe("POST");
    expect(res.fields).toBeDefined();
    // The key the browser must submit is the one WE chose — it is in the signed
    // policy, not free for the client to change.
    expect(res.fields!.key).toBe(KEY);
    expect(res.fields!["Content-Type"]).toBe("application/pdf");
    // A presigned POST from @aws-sdk/s3-presigned-post carries the policy +
    // signature fields the store checks content-length-range / Content-Type
    // against.
    expect(res.fields!.Policy).toBeTruthy();
    expect(res.fields!["X-Amz-Signature"]).toBeTruthy();
    expect(res.provider).toBe("s3");
    expect(res.isMock).toBe(false);

    const ttlMs = new Date(res.expiresAt).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(0);
    expect(ttlMs).toBeLessThanOrEqual(900_000 + 2_000);
  });

  it("createSignedUpload rejects a non-positive maxBytes", async () => {
    const { provider } = providerWithStubbedSend();
    await expect(
      provider.createSignedUpload({ key: KEY, contentType: "application/pdf", maxBytes: 0 }),
    ).rejects.toThrow(/maxBytes/);
  });

  it("createSignedUpload rejects an unsafe key before signing anything", async () => {
    const { provider } = providerWithStubbedSend();
    await expect(
      provider.createSignedUpload({ key: "../evil", contentType: "application/pdf", maxBytes: 100 }),
    ).rejects.toBeInstanceOf(StorageProviderError);
  });

  it("createSignedDownload returns a bounded short-lived signed URL", async () => {
    const { provider } = providerWithStubbedSend();
    const res = await provider.createSignedDownload(KEY);
    expect(res.url).toContain("X-Amz-Signature");
    expect(res.url).toContain("X-Amz-Expires=900");
    const ttlMs = new Date(res.expiresAt).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(0);
    expect(ttlMs).toBeLessThanOrEqual(900_000 + 2_000);
  });

  it("headObject returns authoritative metadata for a stored object", async () => {
    const { provider, send } = providerWithStubbedSend();
    send.mockResolvedValue({
      ContentLength: 4096,
      ContentType: "application/pdf",
      ETag: '"abc123"',
    } as never);

    const meta = await provider.headObject(KEY);
    expect(meta).toEqual({
      key: KEY,
      contentLength: 4096,
      contentType: "application/pdf",
      etag: '"abc123"',
    });
    expect(send.mock.calls[0]![0]).toBeInstanceOf(HeadObjectCommand);
  });

  it("headObject returns null for a missing object (404 / NotFound / NoSuchKey)", async () => {
    for (const err of [
      Object.assign(new Error("not found"), { $metadata: { httpStatusCode: 404 } }),
      Object.assign(new Error("nf"), { name: "NotFound" }),
      Object.assign(new Error("nsk"), { name: "NoSuchKey" }),
    ]) {
      const { provider, send } = providerWithStubbedSend();
      send.mockRejectedValue(err as never);
      await expect(provider.headObject(KEY)).resolves.toBeNull();
    }
  });

  it("headObject sanitizes a non-404 provider error (no bucket/credential leak)", async () => {
    const { provider, send } = providerWithStubbedSend();
    send.mockRejectedValue(
      Object.assign(new Error("AccessDenied on arn:aws:s3:::loadtopia-docs for AKIA_TEST"), {
        name: "AccessDenied",
        $metadata: { httpStatusCode: 403 },
      }) as never,
    );
    const err = await provider.headObject(KEY).catch((e: unknown) => e as StorageProviderError);
    expect(err).toBeInstanceOf(StorageProviderError);
    expect((err as StorageProviderError).message).not.toContain("loadtopia-docs");
    expect((err as StorageProviderError).message).not.toContain("AKIA_TEST");
  });

  it("putObject writes under the exact caller key with authoritative content type; retry reuses the same key", async () => {
    const { provider, send } = providerWithStubbedSend();
    send.mockResolvedValue({} as never);

    const bytes = new Uint8Array([1, 2, 3, 4]);
    const first = await provider.putObject({ key: KEY, contentType: "application/pdf", body: bytes });
    const second = await provider.putObject({ key: KEY, contentType: "application/pdf", body: bytes });

    expect(first.key).toBe(KEY);
    expect(second.key).toBe(KEY); // deterministic — same identity on retry
    for (const call of send.mock.calls) {
      const cmd = call[0] as PutObjectCommand;
      expect(cmd).toBeInstanceOf(PutObjectCommand);
      expect(cmd.input.Key).toBe(KEY);
      expect(cmd.input.ContentType).toBe("application/pdf");
    }
  });

  it("putObject sanitizes a provider failure", async () => {
    const { provider, send } = providerWithStubbedSend();
    send.mockRejectedValue(new Error("boom: secret-bucket internal 500") as never);
    const err = await provider
      .putObject({ key: KEY, contentType: "application/pdf", body: new Uint8Array([0]) })
      .catch((e: unknown) => e as StorageProviderError);
    expect((err as StorageProviderError).code).toBe("PUT_OBJECT_FAILED");
    expect((err as StorageProviderError).message).not.toContain("secret-bucket");
  });

  it("reports real, non-mock, statically-configured health with no live call", async () => {
    const { provider, send } = providerWithStubbedSend();
    const health = await provider.health();
    expect(health.isMock).toBe(false);
    expect(health.status).toBe("ok");
    expect(send).not.toHaveBeenCalled();
  });

  it("its description/name never carries a secret", () => {
    const { provider } = providerWithStubbedSend();
    expect(provider.name).toBe("s3");
    expect(JSON.stringify(provider.name)).not.toContain("secret_test_value");
  });
});
