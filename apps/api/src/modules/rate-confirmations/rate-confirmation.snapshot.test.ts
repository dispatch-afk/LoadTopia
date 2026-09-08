import { describe, expect, it } from "vitest";
import {
  RATE_CONFIRMATION_STORAGE_PREFIX,
  rateConfirmationStorageKey,
} from "./rate-confirmation.snapshot";

describe("rateConfirmationStorageKey", () => {
  const loadId = "11111111-1111-1111-1111-111111111111";
  const rcId = "22222222-2222-2222-2222-222222222222";

  it("is derived only from the two immutable ids, in the documented shape", () => {
    expect(rateConfirmationStorageKey(loadId, rcId)).toBe(
      `${RATE_CONFIRMATION_STORAGE_PREFIX}/${loadId}/${rcId}.pdf`,
    );
  });

  it("is deterministic — the same ids always yield the same key (retry overwrites, never orphans)", () => {
    expect(rateConfirmationStorageKey(loadId, rcId)).toBe(rateConfirmationStorageKey(loadId, rcId));
  });

  it("produces a key the storage-layer key validator accepts", async () => {
    const { assertSafeObjectKey } = await import("@loadtopia/providers");
    expect(() => assertSafeObjectKey(rateConfirmationStorageKey(loadId, rcId))).not.toThrow();
  });
});
