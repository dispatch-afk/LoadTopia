// Milestone 4 release correction (P1-4, plus the P1-4 residual fix): a
// single, framework-agnostic source of truth for resolving the API origin.
// Plain ESM (no TypeScript syntax) so it can be imported both by plain Node
// ESM config files and by TypeScript runtime code (`allowJs` +
// `moduleResolution: "Bundler"` let `.ts` files import this file directly).
//
// Development / test: an absent or blank `API_ORIGIN` silently falls back
// to the local API dev server — unchanged from before this correction.
//
// Production: `API_ORIGIN` must be explicitly configured as a bare
// `https://` origin (no path/query/fragment). Missing, empty, or malformed
// values must fail clearly rather than silently routing real production
// traffic at localhost.
//
// There is no longer a build-time resolver here. The original P1-4 fix used
// `next.config.mjs`'s `rewrites()` to proxy `/api/*` to `API_ORIGIN`, which
// resolves ONCE at `next build` and freezes the result into
// `.next/routes-manifest.json` — a build run without `API_ORIGIN` baked
// `http://localhost:4000` into the shipped artifact PERMANENTLY, with no
// runtime re-check, for every browser-side request (`apiClient()`, ~35 call
// sites including login). That rewrite has been removed; `/api/*` is now
// served by a Next Route Handler (`src/app/api/[...path]/route.ts`) that
// calls {@link getApiOrigin} below at genuine per-request time, exactly like
// `apiServer()` already did. One resolver, one validator, no build-time path
// left that can ever freeze a stale or absent origin into the build output.

/** @type {string} */
const DEV_FALLBACK = "http://localhost:4000";

function stripTrailingSlashes(value) {
  return value.replace(/\/+$/, "");
}

/**
 * Validate a candidate `API_ORIGIN` value for production use. Returns the
 * normalized origin (no trailing slash) or throws a descriptive `Error`.
 * @param {string | undefined} raw
 * @returns {string}
 */
export function assertValidProductionApiOrigin(raw) {
  if (!raw || !raw.trim()) {
    throw new Error(
      "API_ORIGIN is required in production and must be an absolute https:// URL " +
        '(e.g. "https://api.example.com"). Refusing to silently fall back to localhost.',
    );
  }
  const trimmed = raw.trim();

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`API_ORIGIN is not a valid absolute URL in production: "${trimmed}"`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(
      `API_ORIGIN must use https:// in production (got "${parsed.protocol}"): "${trimmed}"`,
    );
  }
  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    throw new Error(
      `API_ORIGIN must be a bare origin with no path, query, or fragment: "${trimmed}"`,
    );
  }

  return stripTrailingSlashes(trimmed);
}

/**
 * Strict resolution for actual server-side runtime use (every real
 * request-time fetch to the API — see `api-server.ts`). Never silently
 * falls back to localhost in production.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolveApiOrigin(env = process.env) {
  const raw = env.API_ORIGIN;
  if (env.NODE_ENV !== "production") {
    return raw && raw.trim() ? stripTrailingSlashes(raw.trim()) : DEV_FALLBACK;
  }
  return assertValidProductionApiOrigin(raw);
}

let cachedApiOrigin;

/**
 * Memoized wrapper around `resolveApiOrigin(process.env)` — the ONE shared
 * runtime resolution used by every genuine per-request server code path that
 * needs to reach the API: `apiServer()` (Server Component fetches) and the
 * `/api/*` Route Handler proxy (`src/app/api/[...path]/route.ts`, browser
 * fetches via `apiClient()`). Neither consumer calls this at module top
 * level — only from inside a request-time function body — so importing
 * either module never resolves (and therefore never throws for) API_ORIGIN
 * during `next build`'s page-data-collection pass.
 * @returns {string}
 */
export function getApiOrigin() {
  if (cachedApiOrigin === undefined) {
    cachedApiOrigin = resolveApiOrigin(process.env);
  }
  return cachedApiOrigin;
}
