import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` is resolved specially by Next's own bundler; nothing in this
// project declares it as a dependency, and no test imported a module using
// it before `api-proxy.ts`. Stub it so Vitest (which runs independently of
// Next's tooling) can resolve the import at all — it has no runtime
// behavior to preserve in a test environment.
vi.mock("server-only", () => ({}));

const getApiOrigin = vi.fn<() => string>();
vi.mock("./api-origin.mjs", () => ({
  getApiOrigin: () => getApiOrigin(),
}));

import { proxyApiRequest } from "./api-proxy";

function mockFetch() {
  const fn = vi.fn();
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("proxyApiRequest — Milestone 4 release correction (P1-4 residual fix)", () => {
  beforeEach(() => {
    getApiOrigin.mockReset();
    getApiOrigin.mockReturnValue("https://api.example.com");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards a GET request's method, resolved-origin path, and query string", async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const req = new Request("http://web.example.com/api/loads/123?foo=bar");
    const res = await proxyApiRequest(req, ["loads", "123"]);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [calledUrl, init] = fetchMock.mock.calls[0]!;
    expect(String(calledUrl)).toBe("https://api.example.com/api/loads/123?foo=bar");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("preserves a POST request's JSON body", async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    const req = new Request("http://web.example.com/api/loads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
    const res = await proxyApiRequest(req, ["loads"]);

    expect(res.status).toBe(204);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe("POST");
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe(JSON.stringify({ a: 1 }));
  });

  it("preserves a PATCH request's JSON body", async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

    const req = new Request("http://web.example.com/api/memberships/m1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });
    await proxyApiRequest(req, ["memberships", "m1"]);

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe("PATCH");
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe(JSON.stringify({ isActive: false }));
  });

  it("forwards a DELETE request", async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    const req = new Request("http://web.example.com/api/network/groups/g1", { method: "DELETE" });
    const res = await proxyApiRequest(req, ["network", "groups", "g1"]);

    expect(res.status).toBe(204);
    const [calledUrl, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe("DELETE");
    expect(String(calledUrl)).toBe("https://api.example.com/api/network/groups/g1");
  });

  it("forwards the incoming Cookie header to the upstream request", async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

    const req = new Request("http://web.example.com/api/auth/me", {
      headers: { cookie: "loadtopia_session=abc123" },
    });
    await proxyApiRequest(req, ["auth", "me"]);

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init.headers as Headers).get("cookie")).toBe("loadtopia_session=abc123");
  });

  it("forwards every upstream Set-Cookie header to the browser response, unjoined", async () => {
    const fetchMock = mockFetch();
    const upstream = new Response("{}", { status: 200 });
    upstream.headers.append("set-cookie", "loadtopia_session=abc; HttpOnly; Path=/");
    upstream.headers.append("set-cookie", "csrf=xyz; Path=/");
    fetchMock.mockResolvedValue(upstream);

    const req = new Request("http://web.example.com/api/auth/login", { method: "POST" });
    const res = await proxyApiRequest(req, ["auth", "login"]);

    expect(res.headers.getSetCookie()).toEqual([
      "loadtopia_session=abc; HttpOnly; Path=/",
      "csrf=xyz; Path=/",
    ]);
  });

  it("preserves upstream status, JSON body, and content-type", async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "CONFLICT", message: "nope", requestId: "r1" } }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );

    const req = new Request("http://web.example.com/api/marketplace/loads/l1/book", { method: "POST" });
    const res = await proxyApiRequest(req, ["marketplace", "loads", "l1", "book"]);

    expect(res.status).toBe(409);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ error: { code: "CONFLICT", message: "nope", requestId: "r1" } });
  });

  it("only forwards an explicit header allowlist (accept, content-type, cookie) — never Host or anything else", async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

    const req = new Request("http://web.example.com/api/loads", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "loadtopia_session=abc", "x-custom": "nope" },
      body: "{}",
    });
    await proxyApiRequest(req, ["loads"]);

    const [, init] = fetchMock.mock.calls[0]!;
    const forwardedKeys = [...(init.headers as Headers).keys()].sort();
    expect(forwardedKeys).toEqual(["accept", "content-type", "cookie"]);
  });

  it("the client cannot choose the upstream host — the resolved origin is always used, regardless of path content", async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

    const req = new Request("http://web.example.com/api/@evil.com");
    await proxyApiRequest(req, ["@evil.com"]);

    const [calledUrl] = fetchMock.mock.calls[0]!;
    const parsed = new URL(String(calledUrl));
    expect(parsed.origin).toBe("https://api.example.com");
    expect(parsed.pathname).toBe("/api/%40evil.com");
  });

  it("a path segment cannot escape the fixed API origin via an embedded slash", async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

    // A single decoded segment that itself contains "/" (as Next would hand
    // us if the browser sent an encoded %2F) must be re-encoded, never
    // treated as an extra path separator.
    const req = new Request("http://web.example.com/api/foo%2Fbar");
    await proxyApiRequest(req, ["foo/bar"]);

    const [calledUrl] = fetchMock.mock.calls[0]!;
    expect(String(calledUrl)).toBe("https://api.example.com/api/foo%2Fbar");
  });

  it("rejects a '..' path segment without ever calling fetch", async () => {
    const fetchMock = mockFetch();
    const req = new Request("http://web.example.com/api/loads/..");
    const res = await proxyApiRequest(req, ["loads", ".."]);

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an invalid/missing production API_ORIGIN never attempts localhost — returns a safe 5xx with no origin value leaked", async () => {
    const fetchMock = mockFetch();
    getApiOrigin.mockImplementation(() => {
      throw new Error(
        "API_ORIGIN is required in production and must be an absolute https:// URL. Refusing to silently fall back to localhost.",
      );
    });

    const req = new Request("http://web.example.com/api/health");
    const res = await proxyApiRequest(req, ["health"]);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("CONFIGURATION_ERROR");
    expect(JSON.stringify(body)).not.toMatch(/localhost/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an upstream network failure produces a safe 502, not a crash or a thrown error", async () => {
    const fetchMock = mockFetch();
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:4000"));

    const req = new Request("http://web.example.com/api/health");
    const res = await proxyApiRequest(req, ["health"]);

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("never follows an upstream redirect automatically", async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "https://api.example.com/elsewhere" } }),
    );

    const req = new Request("http://web.example.com/api/loads");
    const res = await proxyApiRequest(req, ["loads"]);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://api.example.com/elsewhere");
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.redirect).toBe("manual");
  });

  it("204 responses carry no body", async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    const req = new Request("http://web.example.com/api/network/follows/x", { method: "DELETE" });
    const res = await proxyApiRequest(req, ["network", "follows", "x"]);

    expect(res.status).toBe(204);
    expect(await res.arrayBuffer()).toEqual(new ArrayBuffer(0));
  });
});
