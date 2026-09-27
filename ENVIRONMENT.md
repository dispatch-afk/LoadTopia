# LoadTopia — Environment Variables

Every runtime variable, classified. The API validates all of its variables at
boot in `apps/api/src/config/env.ts` (zod) and refuses to start on an invalid
value. The web app reads only the three variables in the last section.

Classes: **Required** · Optional (has a default) · **Dev-only** · **Prod-only** · Selector (chooses a provider) · Conditional (required when a selector picks a real provider).

## Runtime / server

| Variable | Class | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | Optional | `development` | `development` / `test` / `production`. Production enforces `SESSION_COOKIE_SECURE=true`. |
| `API_HOST` | Optional | `0.0.0.0` | |
| `API_PORT` | Optional | `4000` | |
| `CORS_ORIGINS` | Optional (**set explicitly in prod**) | `http://localhost:3000` | Comma-separated exact origins. The default is wrong for any non-local deployment. |
| `LOG_LEVEL` | Optional | `info` | pino level. |
| `DATABASE_URL` | **Required** | — | PostgreSQL URL, `?schema=public`. Pool settings go in the URL (`connection_limit`, `pool_timeout`). |
| `TEST_DATABASE_URL` | **Dev-only** | unset | Enables the integration suite; must be a separate database. |

## Sessions and auth

| Variable | Class | Default | Notes |
|---|---|---|---|
| `SESSION_COOKIE_NAME` | Optional | `loadtopia_session` | Must match the web app's value. |
| `SESSION_TTL_HOURS` | Optional | `168` | 1–2160. |
| `SESSION_COOKIE_SECURE` | **Prod-only = true** | `false` | Boot fails in production if not true. |
| `COOKIE_DOMAIN` | Optional | unset | Leave unset for host-only cookies. |
| `ARGON_MEMORY_KIB` / `ARGON_TIME_COST` / `ARGON_PARALLELISM` | Optional | `19456` / `2` / `1` | OWASP Argon2id baseline. |

## Rate limits (all optional; `*_WINDOW` is a duration string)

`RATE_LIMIT_MAX` (100) · `AUTH_RATE_LIMIT_MAX` (10) · `MARKETPLACE_WRITE_RATE_LIMIT_MAX` (30) · `MARKETPLACE_AWARD_RATE_LIMIT_MAX` (15) · `DOCUMENT_UPLOAD_RATE_LIMIT_MAX` (30), each with a `_WINDOW` defaulting to `1 minute`. Limits are per-IP, in-process (no Redis). Behind the web proxy the API sees the web container's IP for browser traffic.

## Provider selectors

| Variable | Accepted values | Default | Real adapter needs |
|---|---|---|---|
| `ROUTING_PROVIDER` | `mock`, `google` | `mock` | `GOOGLE_ROUTES_API_KEY` or `GOOGLE_MAPS_API_KEY` |
| `GEOCODING_PROVIDER` | `mock`, `google` | `mock` | `GOOGLE_GEOCODING_API_KEY` or `GOOGLE_MAPS_API_KEY` |
| `STORAGE_PROVIDER` | `mock`, `s3` | `mock` | `STORAGE_S3_*` below. **`mock` is non-functional** (no uploads possible). |
| `PRICING_PROVIDER` | `mock` | `mock` | no real adapter exists |
| `CARRIER_VERIFICATION_PROVIDER` | `mock` | `mock` | no real adapter (mock is explicitly NOT FMCSA/DOT/SAFER) |
| `PAYMENT_PROVIDER` | `mock` | `mock` | no real adapter |
| `NOTIFICATION_PROVIDER` | `mock` | `mock` | no real adapter (M5 email will use this abstraction) |
| `TRACKING_PROVIDER` | `mock` | `mock` | no real adapter |

An unknown value, or a real provider with missing configuration, **fails boot**. There is no silent fallback to mock.

## Conditional: Google Maps Platform (server-side only)

`GOOGLE_MAPS_API_KEY` (fallback for both), `GOOGLE_ROUTES_API_KEY`, `GOOGLE_GEOCODING_API_KEY`. Never `NEXT_PUBLIC_*`, never sent to the browser.

## Conditional: S3-compatible object storage (`STORAGE_PROVIDER=s3`)

| Variable | Class | Notes |
|---|---|---|
| `STORAGE_S3_REGION`, `STORAGE_S3_BUCKET`, `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY` | Conditional-required | Missing any → boot failure. |
| `STORAGE_S3_ENDPOINT` | Conditional | **Must be a URL or absent — an empty string fails validation.** Set for MinIO/R2/Spaces; omit for AWS. Must be reachable by the **browser** (presigned URLs embed it). |
| `STORAGE_S3_FORCE_PATH_STYLE` | Optional | `false`; `true` for MinIO. |
| `STORAGE_SIGNED_URL_TTL_SECONDS` | Optional | `900`, bounded 60–3600. |

## Web app (`apps/web`)

| Variable | Class | Notes |
|---|---|---|
| `API_ORIGIN` | **Required in prod** | Bare `https://` origin, no path. Dev/test fall back to `http://localhost:4000`. Resolved at request time (never baked into the build). |
| `SESSION_COOKIE_NAME` | Optional | Must match the API. Read by `middleware.ts` at build time — keep the default unless you rebuild. |
| `NODE_ENV` | set by `next build`/`next start` | |

No `NEXT_PUBLIC_*` variables exist; nothing is exposed to the browser.

## Self-hosting compose variables (`.env.prod`, consumed by `docker-compose.prod.yml` only)

`LT_HOST` (tailnet hostname), `TS_IP` (Tailscale IPv4 to bind Caddy), `POSTGRES_PASSWORD`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `LT_REGISTER_USER` / `LT_REGISTER_HASH` (basic-auth gate on `/register`), optional `STORAGE_S3_BUCKET`, `SESSION_COOKIE_NAME`, `SESSION_TTL_HOURS`, `LOG_LEVEL`, `ROUTING_PROVIDER`, `GEOCODING_PROVIDER`, `GOOGLE_MAPS_API_KEY`.

## Known template issue

`.env.example` ships `STORAGE_S3_ENDPOINT=` (empty). Copied verbatim, the API fails to boot (`Invalid environment configuration`) because `""` is neither absent nor a URL. Delete the line in your `.env` (fix tracked as audit gap F-4 / change L-1).
