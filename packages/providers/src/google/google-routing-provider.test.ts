import { describe, expect, it, vi } from "vitest";
import { GoogleProviderError } from "./shared";
import { GoogleRoutingProvider } from "./google-routing-provider";

const REQUEST = {
  origin: { latitude: 38.6558, longitude: -77.2517 }, // Woodbridge, VA
  destination: { latitude: 34.0736, longitude: -118.4004 }, // Beverly Hills, CA
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

function throwingFetch(message = "network down"): typeof fetch {
  return () => {
    throw new TypeError(message);
  };
}

function provider(fetchImpl: typeof fetch, opts: Partial<{ timeoutMs: number; retries: number }> = {}) {
  return new GoogleRoutingProvider("test-key", {
    fetchImpl,
    retryBaseDelayMs: 1,
    timeoutMs: opts.timeoutMs ?? 5_000,
    retries: opts.retries ?? 1,
  });
}

describe("GoogleRoutingProvider", () => {
  it("maps a successful response, including the transient encoded polyline", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        routes: [{ distanceMeters: 4_264_000, duration: "144000s", polyline: { encodedPolyline: "abc123" } }],
      }),
    );
    const result = await provider(fetchImpl).getRoute(REQUEST);

    expect(result.distanceMeters).toBe(4_264_000);
    expect(result.durationSeconds).toBe(144_000);
    expect(result.provider).toBe("google");
    expect(result.isMock).toBe(false);
    expect(result.encodedPolyline).toBe("abc123");
    expect(typeof result.retrievedAt).toBe("string");
  });

  it("omits encodedPolyline when Google doesn't return one", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { routes: [{ distanceMeters: 100, duration: "10s" }] }));
    const result = await provider(fetchImpl).getRoute(REQUEST);
    expect(result.encodedPolyline).toBeUndefined();
  });

  it("sends travelMode DRIVE (never TRUCK) with the minimal FieldMask and lat/lng", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      jsonResponse(200, { routes: [{ distanceMeters: 1, duration: "1s" }] }),
    );
    await provider(fetchImpl).getRoute(REQUEST);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://routes.googleapis.com/directions/v2:computeRoutes");
    const headers = init!.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("test-key");
    expect(headers["x-goog-fieldmask"]).toBe(
      "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
    );
    const body = JSON.parse(init!.body as string);
    expect(body.travelMode).toBe("DRIVE");
    expect(body).not.toHaveProperty("vehicleInfo");
    expect(body.origin.location.latLng).toEqual({ latitude: REQUEST.origin.latitude, longitude: REQUEST.origin.longitude });
    expect(body.destination.location.latLng).toEqual({
      latitude: REQUEST.destination.latitude,
      longitude: REQUEST.destination.longitude,
    });
  });

  it("rejects a malformed success body (missing/invalid fields) without retrying", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { routes: [{ distanceMeters: "not-a-number" }] }));
    await expect(provider(fetchImpl).getRoute(REQUEST)).rejects.toMatchObject({
      name: "GoogleProviderError",
      code: "MALFORMED_RESPONSE",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("treats an empty routes array as NO_ROUTE, non-retryable", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { routes: [] }));
    await expect(provider(fetchImpl).getRoute(REQUEST)).rejects.toMatchObject({ code: "NO_ROUTE" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps an invalid-key / auth failure to REQUEST_DENIED without retrying", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { error: { status: "UNAUTHENTICATED" } }));
    await expect(provider(fetchImpl).getRoute(REQUEST)).rejects.toMatchObject({ code: "REQUEST_DENIED" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps API-disabled / permission-denied to REQUEST_DENIED without retrying", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, { error: { status: "PERMISSION_DENIED" } }));
    await expect(provider(fetchImpl).getRoute(REQUEST)).rejects.toMatchObject({ code: "REQUEST_DENIED" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a rate-limit/quota (429) response and succeeds, honouring Retry-After", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) return jsonResponse(429, { error: { status: "RESOURCE_EXHAUSTED" } }, { "retry-after": "0" });
      return jsonResponse(200, { routes: [{ distanceMeters: 500, duration: "60s" }] });
    });
    const result = await provider(fetchImpl).getRoute(REQUEST);
    expect(result.distanceMeters).toBe(500);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("gives up after the retry budget on repeated 5xx errors", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503, { error: { status: "UNAVAILABLE" } }));
    await expect(provider(fetchImpl, { retries: 1 }).getRoute(REQUEST)).rejects.toMatchObject({
      code: "SERVER_ERROR",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2); // 1 initial + 1 retry, then gives up
  });

  it("does not retry a bad request (400 / invalid coordinates)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, { error: { status: "INVALID_ARGUMENT" } }));
    await expect(provider(fetchImpl).getRoute(REQUEST)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("times out and is retryable", async () => {
    const fetchImpl = vi.fn(neverRespondingFetch());
    await expect(provider(fetchImpl, { timeoutMs: 10, retries: 1 }).getRoute(REQUEST)).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("surfaces a network failure as retryable", async () => {
    const fetchImpl = vi.fn(throwingFetch());
    await expect(provider(fetchImpl, { retries: 1 }).getRoute(REQUEST)).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("never substitutes mock data on failure — always rejects with a GoogleProviderError", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {}));
    const err = await provider(fetchImpl, { retries: 0 })
      .getRoute(REQUEST)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoogleProviderError);
  });

  it("rejects construction without an API key", () => {
    expect(() => new GoogleRoutingProvider("")).toThrow(/requires an API key/);
  });

  it("reports isMock: false and a configured health check with no live call", async () => {
    const fetchImpl = vi.fn();
    const health = await provider(fetchImpl).health();
    expect(health.isMock).toBe(false);
    expect(health.status).toBe("ok");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
