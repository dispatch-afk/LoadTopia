import { describe, expect, it } from "vitest";
import { StorageProviderError } from "../s3/shared";
import { FakeStorageProvider } from "./fake-storage-provider";

const KEY = "loads/11111111-1111-1111-1111-111111111111/documents/22222222-2222-2222-2222-222222222222";
const RC_KEY = "rate-confirmations/33333333-3333-3333-3333-333333333333/44444444-4444-4444-4444-444444444444.pdf";

describe("FakeStorageProvider", () => {
  it("makes no network calls and needs no configuration", () => {
    const p = new FakeStorageProvider();
    expect(p.name).toBe("fake-storage");
    expect(p.isMock).toBe(false);
  });

  it("records the server-chosen key/contentType/maxBytes on a signed upload request", async () => {
    const p = new FakeStorageProvider();
    const res = await p.createSignedUpload({ key: KEY, contentType: "image/png", maxBytes: 5_000_000 });
    expect(res.method).toBe("POST");
    expect(res.fields!.key).toBe(KEY);
    expect(res.fields!["Content-Type"]).toBe("image/png");
    expect(res.fields!["x-fake-max-bytes"]).toBe("5000000");
    expect(p.signedUploads).toEqual([{ key: KEY, contentType: "image/png", maxBytes: 5_000_000 }]);
  });

  it("headObject returns null before a simulated upload and metadata after", async () => {
    const p = new FakeStorageProvider();
    expect(await p.headObject(KEY)).toBeNull();

    p.simulateUpload(KEY, new Uint8Array(1234), "application/pdf");
    const meta = await p.headObject(KEY);
    expect(meta).toMatchObject({ key: KEY, contentLength: 1234, contentType: "application/pdf" });
    expect(meta!.etag).toBeTruthy();
  });

  it("putObject stores bytes under the exact key; retry keeps the same identity", async () => {
    const p = new FakeStorageProvider();
    await p.putObject({ key: RC_KEY, contentType: "application/pdf", body: new Uint8Array([1, 2, 3]) });
    await p.putObject({ key: RC_KEY, contentType: "application/pdf", body: new Uint8Array([1, 2, 3, 4]) });

    expect(p.storedKeys()).toEqual([RC_KEY]); // one object, not two
    expect(p.getStored(RC_KEY)!.body.byteLength).toBe(4); // last write wins, same key
    const meta = await p.headObject(RC_KEY);
    expect(meta!.contentLength).toBe(4);
  });

  it("createSignedDownload does not require the object to exist (parity with a real signer)", async () => {
    const p = new FakeStorageProvider();
    const res = await p.createSignedDownload(KEY);
    expect(res.url).toContain("fake-storage.test");
    expect(new Date(res.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("simulateOutage makes every storage call fail, and health report it", async () => {
    const p = new FakeStorageProvider();
    p.simulateUpload(KEY, new Uint8Array(1), "application/pdf");
    p.simulateOutage();

    await expect(p.createSignedUpload({ key: KEY, contentType: "application/pdf", maxBytes: 1 })).rejects.toBeInstanceOf(
      StorageProviderError,
    );
    await expect(p.createSignedDownload(KEY)).rejects.toBeInstanceOf(StorageProviderError);
    await expect(p.headObject(KEY)).rejects.toBeInstanceOf(StorageProviderError);
    await expect(p.putObject({ key: KEY, contentType: "application/pdf", body: new Uint8Array(1) })).rejects.toBeInstanceOf(
      StorageProviderError,
    );
    expect((await p.health()).status).toBe("error");

    p.simulateOutage(false);
    expect((await p.health()).status).toBe("ok");
  });

  it("rejects unsafe keys everywhere, like the real provider", async () => {
    const p = new FakeStorageProvider();
    await expect(p.headObject("../escape")).rejects.toBeInstanceOf(StorageProviderError);
    await expect(p.putObject({ key: "a\\b", contentType: "application/pdf", body: new Uint8Array(1) })).rejects.toBeInstanceOf(
      StorageProviderError,
    );
    expect(() => p.simulateUpload("/leading", new Uint8Array(1), "application/pdf")).toThrow(
      StorageProviderError,
    );
  });

  it("can stand in for a specific named provider when a test needs it", () => {
    const p = new FakeStorageProvider({ name: "s3", isMock: false });
    expect(p.name).toBe("s3");
  });
});
