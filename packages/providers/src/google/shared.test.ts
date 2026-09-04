import { describe, expect, it, vi } from "vitest";
import { GoogleProviderError, redactUrl, resolveApiKey, withRetry } from "./shared";

describe("redactUrl", () => {
  it("redacts the key query parameter", () => {
    const url = "https://maps.googleapis.com/maps/api/geocode/json?address=1+Main+St&key=SUPER_SECRET";
    const redacted = redactUrl(url);
    expect(redacted).not.toContain("SUPER_SECRET");
    expect(redacted).toContain("key=%5BREDACTED%5D");
    expect(redacted).toContain("address=");
  });

  it("leaves a URL with no key parameter unchanged", () => {
    const url = "https://routes.googleapis.com/directions/v2:computeRoutes";
    expect(redactUrl(url)).toBe(url);
  });

  it("never throws on an unparseable value", () => {
    expect(redactUrl("not a url")).toBe("[unparseable URL]");
  });
});

describe("resolveApiKey", () => {
  it("prefers the specific key over the shared one", () => {
    expect(resolveApiKey("specific", "shared")).toBe("specific");
  });

  it("falls back to the shared key when no specific key is set", () => {
    expect(resolveApiKey(undefined, "shared")).toBe("shared");
  });

  it("throws when neither key is configured", () => {
    expect(() => resolveApiKey(undefined, undefined)).toThrow(/no API key is configured/);
  });

  it("throws on an empty-string key (not just undefined)", () => {
    expect(() => resolveApiKey("", "")).toThrow(/no API key is configured/);
  });
});

describe("withRetry", () => {
  it("returns the result on first success without retrying", async () => {
    const attempt = vi.fn(async () => "ok");
    const result = await withRetry(attempt, { retries: 2, baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("retries a retryable GoogleProviderError up to the budget, then succeeds", async () => {
    let calls = 0;
    const attempt = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new GoogleProviderError("TIMEOUT", "slow", true);
      return "ok";
    });
    const result = await withRetry(attempt, { retries: 2, baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-retryable GoogleProviderError", async () => {
    const attempt = vi.fn(async () => {
      throw new GoogleProviderError("REQUEST_DENIED", "no", false);
    });
    await expect(withRetry(attempt, { retries: 2, baseDelayMs: 1 })).rejects.toMatchObject({
      code: "REQUEST_DENIED",
    });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("stops after the retry budget is exhausted", async () => {
    const attempt = vi.fn(async () => {
      throw new GoogleProviderError("SERVER_ERROR", "down", true);
    });
    await expect(withRetry(attempt, { retries: 2, baseDelayMs: 1 })).rejects.toMatchObject({
      code: "SERVER_ERROR",
    });
    expect(attempt).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("does not retry a plain (non-GoogleProviderError) error", async () => {
    const attempt = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(withRetry(attempt, { retries: 2, baseDelayMs: 1 })).rejects.toThrow("boom");
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
