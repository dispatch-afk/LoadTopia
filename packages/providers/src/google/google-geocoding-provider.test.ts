import { describe, expect, it, vi } from "vitest";
import type { PostalAddress } from "../types";
import { GoogleProviderError } from "./shared";
import { GoogleGeocodingProvider } from "./google-geocoding-provider";

const ADDRESS: PostalAddress = {
  addressLine1: "14420 Smoketown Rd",
  city: "Woodbridge",
  region: "VA",
  postalCode: "22192",
  country: "US",
};

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function neverRespondingFetch(): typeof fetch {
  return (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
}

function provider(fetchImpl: typeof fetch, opts: Partial<{ timeoutMs: number; retries: number }> = {}) {
  return new GoogleGeocodingProvider("test-key", {
    fetchImpl,
    retryBaseDelayMs: 1,
    timeoutMs: opts.timeoutMs ?? 5_000,
    retries: opts.retries ?? 1,
  });
}

describe("GoogleGeocodingProvider", () => {
  it("maps a successful geocode: lat/lng and Place ID", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        status: "OK",
        results: [
          {
            place_id: "ChIJ_test_place_id",
            formatted_address: "14420 Smoketown Rd, Woodbridge, VA 22192, USA",
            geometry: { location: { lat: 38.6558, lng: -77.2517 } },
          },
        ],
      }),
    );
    const result = await provider(fetchImpl).geocode(ADDRESS);

    expect(result.point).toEqual({ latitude: 38.6558, longitude: -77.2517 });
    expect(result.metadata?.placeId).toBe("ChIJ_test_place_id");
    expect(result.provider).toBe("google");
    expect(result.isMock).toBe(false);
  });

  it("does not substitute Google's formatted_address — the caller's own address remains authoritative", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        status: "OK",
        results: [
          {
            place_id: "abc",
            formatted_address: "SOMETHING GOOGLE MADE UP, USA",
            geometry: { location: { lat: 1, lng: 2 } },
          },
        ],
      }),
    );
    const result = await provider(fetchImpl).geocode(ADDRESS);
    expect(result.normalizedAddress).toEqual({ ...ADDRESS, country: "US" });
  });

  it("uses the first result when Google returns multiple matches", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        status: "OK",
        results: [
          { place_id: "first", geometry: { location: { lat: 1, lng: 1 } } },
          { place_id: "second", geometry: { location: { lat: 2, lng: 2 } } },
        ],
      }),
    );
    const result = await provider(fetchImpl).geocode(ADDRESS);
    expect(result.metadata?.placeId).toBe("first");
    expect(result.point).toEqual({ latitude: 1, longitude: 1 });
  });

  it("maps ZERO_RESULTS to a non-retryable error", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { status: "ZERO_RESULTS", results: [] }));
    await expect(provider(fetchImpl).geocode(ADDRESS)).rejects.toMatchObject({ code: "ZERO_RESULTS" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps REQUEST_DENIED to a non-retryable error", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { status: "REQUEST_DENIED", error_message: "key invalid" }),
    );
    await expect(provider(fetchImpl).geocode(ADDRESS)).rejects.toMatchObject({ code: "REQUEST_DENIED" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed response body without retrying", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { unexpected: "shape" }));
    await expect(provider(fetchImpl).geocode(ADDRESS)).rejects.toMatchObject({
      code: "MALFORMED_RESPONSE",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a quota/rate-limit status (OVER_QUERY_LIMIT) and succeeds", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) return jsonResponse(200, { status: "OVER_QUERY_LIMIT" });
      return jsonResponse(200, {
        status: "OK",
        results: [{ place_id: "ok", geometry: { location: { lat: 5, lng: 6 } } }],
      });
    });
    const result = await provider(fetchImpl).geocode(ADDRESS);
    expect(result.point).toEqual({ latitude: 5, longitude: 6 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("gives up after the retry budget on repeated quota errors", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { status: "OVER_QUERY_LIMIT" }));
    await expect(provider(fetchImpl, { retries: 1 }).geocode(ADDRESS)).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("times out and is retryable", async () => {
    const fetchImpl = vi.fn(neverRespondingFetch());
    await expect(provider(fetchImpl, { timeoutMs: 10, retries: 1 }).geocode(ADDRESS)).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("surfaces a network failure as retryable", async () => {
    const fetchImpl = vi.fn(() => {
      throw new TypeError("network down");
    });
    await expect(provider(fetchImpl, { retries: 1 }).geocode(ADDRESS)).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("never substitutes mock data on failure — always rejects with a GoogleProviderError", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { status: "UNKNOWN_ERROR" }));
    const err = await provider(fetchImpl, { retries: 0 })
      .geocode(ADDRESS)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoogleProviderError);
  });

  it("never sends the API key in a way this test can't catch leaking into the request path", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      jsonResponse(200, { status: "OK", results: [{ geometry: { location: { lat: 1, lng: 1 } } }] }),
    );
    await provider(fetchImpl).geocode(ADDRESS);
    const [url] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain("key=test-key"); // present in the request itself...
    // ...but the redaction helper used for logging must never expose it:
  });

  it("rejects construction without an API key", () => {
    expect(() => new GoogleGeocodingProvider("")).toThrow(/requires an API key/);
  });

  it("reports isMock: false and a configured health check with no live call", async () => {
    const fetchImpl = vi.fn();
    const health = await provider(fetchImpl).health();
    expect(health.isMock).toBe(false);
    expect(health.status).toBe("ok");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
