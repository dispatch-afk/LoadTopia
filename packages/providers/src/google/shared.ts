/**
 * Shared plumbing for the real Google Maps Platform adapters
 * (GoogleGeocodingProvider, GoogleRoutingProvider). Framework-free, no
 * dependency on `apps/api` — matches the rest of this package.
 *
 * Nothing here ever logs or throws a raw request URL, header, or Google
 * response body: the API key must never reach a log line or a client-visible
 * error message (see each call site's `sanitize*` usage).
 */

/** Stable, typed failure from a Google Maps Platform call. Never carries the
 *  API key or the raw request URL — only a machine code, a safe message, and
 *  whether the SAME request is worth retrying. */
export class GoogleProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  /** Milliseconds to wait before retrying, when Google specified one. */
  readonly retryAfterMs?: number;

  constructor(code: string, message: string, retryable: boolean, retryAfterMs?: number) {
    super(message);
    this.name = "GoogleProviderError";
    this.code = code;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface RetryOptions {
  /** Number of retries AFTER the first attempt (0 = no retries). */
  retries: number;
  /** Base delay for exponential backoff, before jitter. */
  baseDelayMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `attempt` up to `1 + retries` times. Only retries when the thrown
 * error is a {@link GoogleProviderError} with `retryable: true` — network
 * errors, timeouts, 5xx, and quota/rate-limit responses are wrapped as such
 * by the callers below. Every other error (bad request, invalid key, API
 * disabled, no route/zero results, malformed response) is NOT retryable and
 * is rethrown immediately. Exponential backoff with jitter; honours a
 * server-specified `retryAfterMs` when present.
 */
export async function withRetry<T>(attempt: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i <= opts.retries; i++) {
    try {
      return await attempt();
    } catch (err) {
      lastError = err;
      const retryable = err instanceof GoogleProviderError && err.retryable;
      if (!retryable || i === opts.retries) throw err;
      const backoff = opts.baseDelayMs * 2 ** i;
      const jitter = Math.random() * backoff * 0.25;
      const delay = (err as GoogleProviderError).retryAfterMs ?? backoff + jitter;
      await sleep(delay);
    }
  }
  // Unreachable — the loop always returns or throws — but keeps TS happy.
  throw lastError;
}

export interface FetchJsonOptions {
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}

/**
 * A single HTTP attempt with a hard timeout. Converts every transport-level
 * failure (abort/timeout, DNS/connection failure, non-2xx HTTP status, or a
 * non-JSON body) into a {@link GoogleProviderError} — callers only ever see a
 * parsed JSON body or a typed error, never a raw fetch exception. 5xx and 429
 * are marked retryable (429 honours `Retry-After` if present); every other
 * non-2xx status is NOT retryable. Never includes the request URL, headers,
 * or body in the thrown error's message (both can carry the API key).
 */
export async function fetchJson(url: string, options: FetchJsonOptions): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  let res: Response;
  try {
    res = await options.fetchImpl(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      throw new GoogleProviderError("TIMEOUT", "Google Maps Platform request timed out", true);
    }
    throw new GoogleProviderError(
      "NETWORK_ERROR",
      "Could not reach Google Maps Platform (network failure)",
      true,
    );
  } finally {
    clearTimeout(timer);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new GoogleProviderError(
      "MALFORMED_RESPONSE",
      `Google Maps Platform returned a non-JSON response (HTTP ${res.status})`,
      false,
    );
  }

  if (!res.ok) {
    if (res.status === 429) {
      const retryAfterHeader = res.headers.get("retry-after");
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
      throw new GoogleProviderError(
        "RATE_LIMITED",
        "Google Maps Platform rate limit or quota exceeded",
        true,
        Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
      );
    }
    if (res.status >= 500) {
      throw new GoogleProviderError(
        "SERVER_ERROR",
        `Google Maps Platform returned a server error (HTTP ${res.status})`,
        true,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new GoogleProviderError(
        "REQUEST_DENIED",
        "Google Maps Platform rejected the request (invalid key, disabled API, or billing issue)",
        false,
      );
    }
    throw new GoogleProviderError(
      "INVALID_REQUEST",
      `Google Maps Platform rejected the request (HTTP ${res.status})`,
      false,
    );
  }

  return body;
}

/** Never log a URL that may carry `?key=...` (the Geocoding API's auth scheme). */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.searchParams.has("key")) u.searchParams.set("key", "[REDACTED]");
    return u.toString();
  } catch {
    return "[unparseable URL]";
  }
}

export function resolveApiKey(specific: string | undefined, shared: string | undefined): string {
  const key = specific || shared;
  if (!key) {
    throw new Error(
      "Google Maps Platform provider selected but no API key is configured " +
        "(set GOOGLE_MAPS_API_KEY, or the API-specific override).",
    );
  }
  return key;
}
