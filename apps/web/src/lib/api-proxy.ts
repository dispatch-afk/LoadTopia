import "server-only";
import type { ApiErrorBody } from "@loadtopia/shared";
import { getApiOrigin } from "./api-origin.mjs";

/**
 * Milestone 4 release correction (P1-4 residual fix): the runtime proxy
 * behind `/api/*` (see `src/app/api/[...path]/route.ts`). Replaces the
 * removed `next.config.mjs` external rewrite, whose destination froze
 * `API_ORIGIN` at `next build` time — this resolves it fresh, via the same
 * strict `getApiOrigin()` `apiServer()` uses, on every real request.
 *
 * The destination host/scheme is ALWAYS `getApiOrigin()`'s validated value;
 * the incoming request only ever contributes the path and query string
 * (never the origin), so a browser client can never redirect this proxy at
 * an arbitrary host.
 */

const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

class InvalidPathError extends Error {}

/** Reassemble the catch-all route segments into a safe `/api/...` pathname.
 *  Next has already split the incoming URL on `/` to produce `segments`, so
 *  no segment can itself smuggle an extra `/` unless it arrived
 *  percent-encoded (`%2F`) — re-encoding each segment before rejoining turns
 *  that back into a literal `%2F` instead of a path separator. `.`/`..`
 *  segments are rejected outright as defense-in-depth (Next's router already
 *  normalizes these before a request ever reaches this handler). */
function buildUpstreamPath(segments: string[]): string {
  const safe = segments.map((segment) => {
    if (segment === "" || segment === "." || segment === "..") {
      throw new InvalidPathError(`invalid path segment: "${segment}"`);
    }
    return encodeURIComponent(segment);
  });
  return `/api/${safe.join("/")}`;
}

/** Setting `.pathname`/`.search` on an existing `URL` can never change its
 *  origin — this is the mechanism that guarantees the client-controlled path
 *  can only ever select a path/query under `getApiOrigin()`, never a
 *  different host. */
function buildUpstreamUrl(origin: string, segments: string[], search: string): URL {
  const url = new URL(origin);
  url.pathname = buildUpstreamPath(segments);
  url.search = search;
  return url;
}

function forwardedRequestHeaders(incoming: Headers): Headers {
  const headers = new Headers();
  headers.set("accept", "application/json");
  const contentType = incoming.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const cookie = incoming.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  return headers;
}

/** Only what the browser actually needs back: body content type, every
 *  `Set-Cookie` (read via `getSetCookie()` so multiple cookies survive
 *  intact — `headers.get("set-cookie")` would incorrectly join them into
 *  one comma-separated string), and `Location` for the rare 3xx. Everything
 *  else (transport/hop-by-hop headers, upstream-only framing headers) is
 *  deliberately dropped rather than passed through. */
function forwardedResponseHeaders(upstream: Response): Headers {
  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  for (const cookie of upstream.headers.getSetCookie()) {
    headers.append("set-cookie", cookie);
  }
  const location = upstream.headers.get("location");
  if (location) headers.set("location", location);
  return headers;
}

function jsonErrorResponse(status: number, code: string, message: string): Response {
  const body: ApiErrorBody = { error: { code, message, requestId: crypto.randomUUID() } };
  return Response.json(body, { status });
}

/** Proxies one incoming `/api/*` request to the real API, resolving
 *  `API_ORIGIN` at this genuine request time (never at build time, never
 *  cached across an invalid value). Never throws — every failure mode
 *  becomes a generic, client-safe JSON error response; the actual
 *  configuration error or network failure is logged server-side only. */
export async function proxyApiRequest(request: Request, pathSegments: string[]): Promise<Response> {
  let origin: string;
  try {
    origin = getApiOrigin();
  } catch (err) {
    // Production with a missing/malformed API_ORIGIN. Never localhost, never
    // the raw configuration error text, in the response sent to the browser.
    // eslint-disable-next-line no-console
    console.error(
      "[api-proxy] cannot resolve API_ORIGIN:",
      err instanceof Error ? err.message : err,
    );
    return jsonErrorResponse(
      500,
      "CONFIGURATION_ERROR",
      "The server is not configured correctly. Please try again later.",
    );
  }

  let targetUrl: URL;
  try {
    const incomingUrl = new URL(request.url);
    targetUrl = buildUpstreamUrl(origin, pathSegments, incomingUrl.search);
  } catch (err) {
    if (err instanceof InvalidPathError) {
      return jsonErrorResponse(400, "INVALID_PATH", "That request path is not valid.");
    }
    throw err;
  }

  const method = request.method.toUpperCase();
  const body = METHODS_WITH_BODY.has(method) ? await request.arrayBuffer() : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method,
      headers: forwardedRequestHeaders(request.headers),
      body,
      redirect: "manual",
      cache: "no-store",
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[api-proxy] upstream request failed:", err instanceof Error ? err.message : err);
    return jsonErrorResponse(
      502,
      "UPSTREAM_UNAVAILABLE",
      "The service is temporarily unavailable. Please try again.",
    );
  }

  const responseBody = NULL_BODY_STATUSES.has(upstream.status) ? null : await upstream.arrayBuffer();
  return new Response(responseBody, {
    status: upstream.status,
    headers: forwardedResponseHeaders(upstream),
  });
}
