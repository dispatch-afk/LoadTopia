# LoadTopia — Architecture

_Baseline: Phase 0. Milestone 1 additions: see [`MILESTONE-1.md`](MILESTONE-1.md).
Milestone 2 (marketplace): see [`MILESTONE-2.md`](MILESTONE-2.md). Milestone 3
(operations): see [`MILESTONE-3.md`](MILESTONE-3.md)._

This document explains the system design and the reasoning behind the significant
technology choices. It is the reference for how the codebase is meant to grow.
Milestone 1 (companies, membership-based authz + active-company context,
locations, equipment, load CRUD + lifecycle + routing), Milestone 2 (carrier
marketplace profiles + eligibility, load board, offers/counteroffers over an
immutable round history, atomic load award, pricing snapshots, carrier
verification abstraction), and Milestone 3 (post-award operational lifecycle,
manual check-ins, operational documents on private object storage, shipper POD
review, immutable Rate Confirmation snapshot, operational frontend) build on this
foundation without changing it — details and the DB migrations are in the
per-milestone docs.

---

## 1. System overview

```
        Browser
           │  HTTPS (cookies: httpOnly session)
           ▼
   ┌───────────────┐        ┌──────────────────────────────┐
   │  Next.js web  │ ─────▶ │   Fastify API  (apps/api)     │
   │  (apps/web)   │  REST  │   — authoritative business    │
   │  thin client  │        │     logic & authorization     │
   └───────────────┘        └───────┬───────────────┬───────┘
                                    │               │
                          ┌─────────▼──────┐  ┌─────▼───────────────┐
                          │  PostgreSQL 16 │  │ Provider registry    │
                          │  (Prisma)      │  │ routing / pricing /  │
                          │                │  │ geocoding / payment /│
                          │                │  │ storage / notify /   │
                          │                │  │ tracking             │
                          └────────────────┘  └─────────────────────┘
```

**Principle: API-first.** Every business rule — load lifecycle transitions,
pricing, authorization, validation — lives in the backend (`apps/api` +
`packages/domain`). The frontend renders state and collects input. It is never
the authoritative source of a rule and its permission checks are cosmetic.

---

## 2. Repository shape — pnpm monorepo

A single repo with independently-scoped packages:

| Package                | Responsibility                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `@loadtopia/shared`    | Enums, zod schemas, DTO/wire types. Imported by both api and web.                                                        |
| `@loadtopia/domain`    | Pure business logic: load state machine, RBAC permissions, resource policies. No I/O, no framework. Heavily unit-tested. |
| `@loadtopia/db`        | Prisma schema, migrations, seed, and a `PrismaClient` singleton + health probe.                                          |
| `@loadtopia/providers` | External-service interfaces and their mock implementations + a registry/factory.                                         |
| `@loadtopia/api`       | Fastify HTTP layer: plugins, route modules, wiring. Thin — delegates to `domain`.                                        |
| `@loadtopia/web`       | Next.js App Router client.                                                                                               |

**Why monorepo + a dedicated API service** (rather than one Next.js app with
route handlers): LoadTopia's roadmap includes enterprise customers, third-party
API clients, and background/AI automation. Those consume the same business core
as the web app. Keeping the authoritative backend as a standalone service with
its own deployment lifecycle prevents the domain from coupling to a frontend
framework's request model, and lets the API scale and deploy independently.

**Why Fastify** (vs. NestJS / Express):

- First-class TypeScript, schema-based validation, and structured logging (pino) built in.
- Plugin encapsulation model keeps modules isolated.
- Much lighter than NestJS — no DI framework or decorator metadata to build the
  whole app around. NestJS remains a reasonable alternative if the team later
  wants its batteries-included structure; the domain logic in `packages/domain`
  is framework-agnostic and would port unchanged.
- Express 5 would also work but ships less out of the box (validation, logging, typing).

**Why internal packages are consumed as source** (no per-package build step):
`tsx`, Vitest, Next (`transpilePackages`), and `tsup` all read TypeScript
directly, so dev has no build-ordering problem. Only `apps/api` produces a
build artifact for production, via `tsup`, which bundles the `@loadtopia/*`
packages into a single deployable.

---

## 3. Frontend (`apps/web`)

Next.js 15 App Router, React 19. Phase 0 ships one server component that renders
the live API health report and states plainly that the product is not built yet.

Rules going forward:

- No business rules in the client. Call the API.
- The API is the session authority; the browser holds only an httpOnly cookie.
- Types shared with the backend come from `@loadtopia/shared` — never redefined.

---

## 4. Backend (`apps/api`)

Fastify instance assembled in `src/app.ts` via `buildApp()`, which returns the
instance **without listening** so tests can use `app.inject()`. `src/index.ts`
adds `listen()` + graceful shutdown.

**Plugin layers** (`src/plugins/`):

| Plugin            | Provides                                                                                |
| ----------------- | --------------------------------------------------------------------------------------- |
| `request-context` | Per-request id (honours inbound `x-request-id`), response header, log binding.          |
| `prisma`          | `app.prisma` — injectable for tests; owns disconnect when it created the client.        |
| `providers`       | `app.providers` — the provider registry built from config; warns when mocks are active. |
| `security`        | helmet, CORS allowlist, cookie parsing, global rate limit.                              |
| `auth`            | `app.authenticate` preHandler and `app.requirePermission(p)` factory.                   |

**Route modules** (`src/modules/<name>/`): each exports a Fastify plugin
registering its routes; all are mounted under `/api`. Business logic sits in a
`*.service.ts` beside the routes, or in `@loadtopia/domain` when it is pure.

**Error handling** (`src/lib/errors.ts`): a single error handler maps `ZodError`
→ 400 `VALIDATION_ERROR`, `AppError` → its status/code, Fastify errors →
passthrough, everything else → 500 `INTERNAL_ERROR`. Every response body is
`{ error: { code, message, requestId, details? } }`.

**Observability**: structured pino logs (pretty in dev, JSON in prod), request
ids on every log line and response, `GET /api/health` (DB + provider checks),
`/api/health/live` (liveness), `/api/health/ready` (readiness).

---

## 5. Database (`packages/db`)

PostgreSQL 16, Prisma 6.

Conventions (enforced by review):

- **UUID primary keys** — column type `uuid`, default `gen_random_uuid()`
  (Postgres core). Moving to UUIDv7 later is an application-side generation
  change, not a schema migration.
- **`timestamptz(6)`, always UTC.** `created_at` defaulted, `updated_at` via `@updatedAt`.
- **Money is `NUMERIC(14,2)`** via Prisma `Decimal`. Never a floating-point type.
  Amounts cross the API as decimal strings.
- **Foreign keys everywhere**, with deliberate `onDelete` behaviour
  (`Restrict` for references that must not orphan financial/history rows,
  `Cascade` for owned children, `SetNull` for optional actors).
- **Indexes** on every FK used for lookup and on common query predicates
  (`loads(status)`, `loads(shipper_company_id, status)`, event time-ranges, …).
- **Append-only tables**: `load_events`, `market_rates`, `audit_logs`,
  `offer_rounds`, `offer_events`, `pricing_snapshots`, `document_reviews`
  (all with a DB trigger rejecting UPDATE/DELETE), and `rate_confirmations`
  (commercial columns immutable by trigger; DELETE blocked; only three
  generation-metadata columns updatable). `load_check_ins` is append-only by
  API surface (no mutation path) but has no dedicated trigger. Application code
  only ever `INSERT`s this history — it is a core asset.

### Entities

- **Phase 0 / M1**: `companies`, `users`, `company_users`, `sessions`,
  `locations`, `equipment`, `lanes`, `market_rates`, `loads`, `load_events`,
  `audit_logs`.
- **M2 (marketplace)**: `carrier_profiles`, `offer_threads`, `offer_rounds`,
  `offer_events`, `pricing_snapshots`.
- **M3 (operations)**: `load_check_ins`, `load_documents`, `document_reviews`,
  `rate_confirmations`; `loads` gains `picked_up_at` / `delivered_at` /
  `completed_at`; `load_events` gains `actor_company_id`.

Still deferred (attach via new tables + FKs without reshaping the core):
`tracking_events` / `carrier_locations`, `payments`, `payouts`, `invoices`,
`disputes`, `api_keys`, `integrations`, `saved_searches`, `lane_statistics`,
`subscriptions`.

### Migrations

Prisma Migrate. Committed SQL migrations live in `packages/db/prisma/migrations/`.
`pnpm db:migrate` (dev, creates), `pnpm db:migrate:deploy` (CI/prod, applies).
The initial migration is generated offline with `prisma migrate diff` and then
verified against a real database.

---

## 6. Authentication

- **Password hashing**: Argon2id (`@node-rs/argon2`), parameters from validated
  env (OWASP baseline: 19 MiB / t=2 / p=1).
- **Sessions**: opaque 256-bit tokens (base64url). The raw token goes to the
  client in an `httpOnly` + `SameSite=Lax` (+ `Secure` in prod) cookie. Only the
  **SHA-256 hash** is stored (`sessions.token_hash`). Lookups by hash; logout and
  admin revocation are row updates — unlike stateless JWTs.
- **Login** returns a uniform "Invalid email or password" and performs a hash
  verification even when the email is unknown, to avoid user enumeration and
  timing signals.
- **Why not Auth.js / Clerk / Auth0**: identity data ownership. LoadTopia's
  auth lives in its own API and database. External identity providers can be
  added later as federated login _options_, not as the system of record.

Future: `api_keys` table for `API_CLIENT`, optional TOTP MFA, SSO for enterprise.

---

## 7. Authorization

RBAC with an explicit **permission catalogue** (`packages/domain/src/authz/`):

- Routes and services check **permissions** (`load:create`, `offer:create`,
  `admin:panel`, …), never role strings. New roles (BROKER, 3PL, DISPATCHER,
  DRIVER, ACCOUNTING, …) are added by declaring their permission set — zero
  changes at call sites.
- A user's role is carried on their **company membership** (`company_users`),
  not the user row. A user can be a SHIPPER at one company and a CARRIER at
  another; the API resolves the acting company per request (primary membership
  in Phase 0; explicit company switch later).
- **Resource policies** (`policy.ts`) layer object-level checks on top of
  permissions: e.g. `canReadLoad` lets the owning shipper and the assigned
  carrier (and staff) see a load and no one else; `canModifyLoad` restricts
  mutation to the owning shipper.
- Enforcement is **server-side only**. `app.requirePermission(p)` is the route
  guard; policies are called inside services with the loaded resource.

Initial roles: `SHIPPER`, `CARRIER`, `ADMIN`.

---

## 8. Load lifecycle (state machine)

`packages/domain/src/load/load-state-machine.ts` is the authority.

```
DRAFT → POSTED → OFFER_RECEIVED → AWARDED → CARRIER_ASSIGNED
      → PICKED_UP → IN_TRANSIT → DELIVERED → COMPLETED
```

- All ten statuses are exposed (`EXPOSED_LOAD_STATUSES`). Milestone 3 made
  `PICKED_UP … COMPLETED` live.
- `CANCELLED` is reachable from any state **before** the freight is in motion
  (`DRAFT`…`CARRIER_ASSIGNED`). Once `PICKED_UP`, cancellation would require a
  dedicated exception/dispute flow — **not built** (a later milestone; the
  `EXCEPTION_REPORTED` enum value is reserved schema headroom only).
- `COMPLETED` and `CANCELLED` are terminal.
- The backend routes every status change through `assertLoadTransition(from,to)`
  and `atomicLoadTransition()` (compare-and-set `where status = from`) and, in
  the same DB transaction, writes an **immutable `load_events` row** (carrying
  `actor_company_id` since M3, so carrier- and shipper-authored events are
  distinguishable).
- The client can never set `status` directly — it expresses intent via specific
  endpoints (`/post`, `/assign`, `/pickup`, `/in-transit`, `/deliver`,
  `/complete`, `/cancel`) that the API validates. Carrier movement endpoints are
  authorized by `canOperateShipment` (assigned carrier company only);
  `/complete` is shipper-only and additionally gated by an active **approved
  POD**. `/post` is DRAFT-only.
- `availableTransitions` in `LoadView` is **actor-aware** — filtered to the
  transitions the requesting viewer could actually trigger — and never advertises
  the reserved `OFFER_RECEIVED/AWARDED → POSTED` domain edge (which has no
  endpoint). `completionReady` is the separate objective "an approved POD
  exists" fact.

---

## 9. Provider abstraction (`packages/providers`)

Every external dependency is an interface here; application code imports only the
interface. Each response carries provenance: `{ provider, isMock, retrievedAt, metadata }`.

| Interface              | Mock impl (default)                                                    | Real impl                                                                                             |
| ---------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `RoutingProvider`      | `MockRoutingProvider`                                                  | `GoogleRoutingProvider` (Routes API, `travelMode: DRIVE`)                                             |
| `PricingProvider`      | `MockPricingProvider`                                                  | DAT, Truckstop, `LoadTopiaPricingProvider` _(not built — still mock)_                                 |
| `GeocodingProvider`    | `MockGeocodingProvider`                                                | `GoogleGeocodingProvider` (Geocoding API)                                                             |
| `PaymentProvider`      | `MockPaymentProvider`                                                  | Stripe, Adyen, a factoring partner _(not built)_                                                      |
| `StorageProvider`      | `MockStorageProvider` (non-functional) / `FakeStorageProvider` (tests) | **`S3StorageProvider`** — private S3-compatible bucket, presigned POST uploads (built, M3)            |
| `NotificationProvider` | `MockNotificationProvider`                                             | Postmark/SES (email), Twilio (SMS) _(not built — still mock)_                                         |
| `TrackingProvider`     | `MockTrackingProvider`                                                 | project44, FourKites, ELD integrations _(not built; M3 check-ins are manual, not via this interface)_ |

Rules:

- Mocks are **deterministic** and set `isMock: true`; pricing mocks also set a
  non-null `disclaimer` string that the API and UI must surface verbatim.
- `createProviderRegistry` **throws** on any unimplemented selection, and on
  `google` with no API key configured — a misconfigured environment fails at
  boot rather than silently serving synthetic data. There is no runtime
  fallback from a real provider to a mock.
- A load's `isMock` routing flag is derived from the provider name **stored on
  that load** (`routingProvider`), never from whichever adapter is currently
  configured — a load routed by the mock keeps showing as mock even after a
  later production cutover to `google`.
- No undocumented third-party APIs, no credentials, no fabricated responses in
  this repo.

### Google Maps Platform (routing + geocoding)

`ROUTING_PROVIDER`/`GEOCODING_PROVIDER` accept `google` in addition to `mock`.
Real, server-side only (`packages/providers/src/google/`); the API key is
never read by `apps/web` and never reaches the browser.

- **Phase 1 scope**: real road distance/duration (`travelMode: DRIVE`) and
  real geocoding. **Not** truck-restriction-aware routing — Google's large
  vehicle / `TRUCK` travel mode needs vehicle height/width/length/weight/axle
  data LoadTopia does not collect anywhere today, and is a separately
  access-gated Google feature. Do not represent Phase 1 routing as
  truck-aware.
- **Render (production)**: `ROUTING_PROVIDER=google`, `GEOCODING_PROVIDER=google`,
  `GOOGLE_MAPS_API_KEY=<secret>` (optionally split into
  `GOOGLE_ROUTES_API_KEY`/`GOOGLE_GEOCODING_API_KEY`, both falling back to
  `GOOGLE_MAPS_API_KEY`). Requires the **Routes API** and **Geocoding API**
  enabled on the Google Cloud project, with the key restricted to those APIs.
- **Local dev / CI**: leave unset — both providers default to `mock`.
- A routing failure never blocks creating or saving a load/location. It does
  block **posting**: if the configured routing provider is real (`isMock:
false`) and a load has no computed distance, `POST /api/loads/:id/post`
  returns 409 rather than letting the marketplace post with a `MockPricingProvider`
  fallback to a fully synthetic lane distance as if routing had succeeded.

### Pricing (strategic)

`PricingProvider` is intentionally minimal now — **still `[MOCK]` only**. The
eventual `LoadTopiaPricingProvider` will blend external market data with
LoadTopia's own transaction history, lane statistics, equipment, distance,
capacity signals, seasonality, carrier acceptance rates, and time-to-cover —
which is why `market_rates` is append-only from day one.

### Object storage (`StorageProvider`, Milestone 3)

Operational documents (BOL / POD / OTHER) and the rendered Rate Confirmation PDF
live in a **private, non-public** S3-compatible bucket. The interface is
`createSignedUpload` / `createSignedDownload` / `headObject` / `putObject`.

- **`MockStorageProvider`** (default `STORAGE_PROVIDER=mock`) is deliberately
  **non-functional** — signed URLs resolve nowhere, `headObject` always returns
  `null`, nothing is stored. It exists only for local dev where storage is
  irrelevant. Anything that needs working uploads must select a real provider.
- **`FakeStorageProvider`** is an in-process, byte-storing stand-in used by the
  integration tests (`simulateUpload`, `simulateOutage`). Never registered.
- **`S3StorageProvider`** (`STORAGE_PROVIDER=s3`) is the real adapter (AWS S3,
  Cloudflare R2, MinIO, DigitalOcean Spaces). Uploads use a **presigned POST**
  (the only mechanism that enforces `content-length-range` and an exact
  `Content-Type` at the storage layer); downloads are short-lived presigned
  GETs. Persistent credentials live only in the API process and are never read
  by `apps/web`, never returned by `/api/health`, never logged.
- `STORAGE_PROVIDER=s3` with any of `STORAGE_S3_REGION`, `STORAGE_S3_BUCKET`,
  `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY` missing **fails
  process startup** (`resolveS3StorageConfig` throws, mirroring the Google key
  check). There is **no fallback to `MockStorageProvider`**.
- Object keys are always **server-generated**
  (`loads/{loadId}/documents/{documentId}`,
  `rate-confirmations/{loadId}/{rateConfirmationId}.pdf`) and re-validated by
  `assertSafeObjectKey`; the browser never constructs one.
- Production packaging: the AWS SDK v3 (`@aws-sdk/client-s3`,
  `@aws-sdk/s3-presigned-post`, `@aws-sdk/s3-request-presigner`) is kept
  **external** from the `tsup` bundle (large, does dynamic `require()`) and is
  declared as a direct dependency of **both** `@loadtopia/providers` and
  `@loadtopia/api`, so `pnpm --filter=@loadtopia/api deploy --prod` prunes it
  into the production `node_modules` at top level (the bundled provider code
  resolves it there). Verified: the pruned artifact boots with
  `STORAGE_PROVIDER=s3` and constructs `S3StorageProvider` with no
  `MODULE_NOT_FOUND`.

---

## 10. Testing

Vitest. Layers:

| Layer             | Where                                          | Needs a DB?                   |
| ----------------- | ---------------------------------------------- | ----------------------------- |
| Unit (domain)     | `packages/domain/**/*.test.ts`                 | no                            |
| Unit (providers)  | `packages/providers/**/*.test.ts`              | no                            |
| Unit (shared)     | `packages/shared/**/*.test.ts`                 | no                            |
| Config            | `apps/api/src/__tests__/env.test.ts`           | no                            |
| API (inject)      | `apps/api/src/__tests__/*.test.ts`             | no (fake Prisma)              |
| Integration (E2E) | `apps/api/src/__tests__/*.integration.test.ts` | **yes** (`TEST_DATABASE_URL`) |

`pnpm test` runs everything that needs no external services (safe on any
machine, in any CI). `pnpm test:integration` runs the DB-backed suite and is
auto-skipped when `TEST_DATABASE_URL` is unset. CI runs both against a Postgres
service container. State-machine and authorization rules are covered by unit
tests; the full register → session → `/me` → logout flow is covered by
integration tests.

---

## 11. Configuration

All runtime config is validated once at boot by `apps/api/src/config/env.ts`
(zod). Nothing else reads `process.env`. Missing/invalid values fail the process
immediately with a readable list. `.env.example` is the canonical list of
variables; `.env` is never committed. Production requires
`SESSION_COOKIE_SECURE=true`.

---

## 12. Deployment direction

- **GitHub is the source of truth.** CI (`.github/workflows/ci.yml`) runs
  typecheck, lint, unit tests, migrations, integration tests, and build on every
  push/PR.
- **Artifacts are containers.** `apps/api` builds to a single bundle → a small
  Node image. `apps/web` deploys as a Next.js server (container) or to a Next
  host; it holds no state.
- **Target infrastructure is owner-controlled cloud** — e.g. AWS: ECS Fargate
  (or EKS) for the API, RDS PostgreSQL, S3 for documents, plus a CDN for the web
  app. Fly.io / Render are acceptable earlier stages. There is deliberately **no**
  runtime lock-in to any single PaaS, and no dependency on Replit.
- Secrets come from the platform's secret manager (AWS Secrets Manager / SSM),
  injected as environment variables.

### Milestone 3 — production object storage

Operational documents require a real, private S3-compatible bucket. Set on the
API service:

| Variable                                                    | Notes                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `STORAGE_PROVIDER=s3`                                       | selects `S3StorageProvider`; missing S3 config → boot failure                               |
| `STORAGE_S3_REGION`                                         | required                                                                                    |
| `STORAGE_S3_BUCKET`                                         | required; a **private** bucket (no public read)                                             |
| `STORAGE_S3_ACCESS_KEY_ID` / `STORAGE_S3_SECRET_ACCESS_KEY` | required; IAM principal scoped to this bucket only (`GetObject`, `PutObject`, `HeadObject`) |
| `STORAGE_S3_ENDPOINT`                                       | omit for AWS S3; set for R2 / MinIO / Spaces                                                |
| `STORAGE_S3_FORCE_PATH_STYLE`                               | `true` for MinIO / some R2 setups                                                           |
| `STORAGE_SIGNED_URL_TTL_SECONDS`                            | 60–3600, default 900 (15 min)                                                               |

**Bucket CORS** — the browser uploads directly to the bucket (presigned POST)
and follows presigned GET links, so the bucket must allow the **web app origin**
(the Vercel/production URL that serves `apps/web`, e.g.
`https://app.loadtopia.com`) — not `*`:

```jsonc
[
  {
    "AllowedOrigins": ["https://<web-app-origin>"],
    "AllowedMethods": ["POST", "GET"], // POST = presigned upload; GET = download
    "AllowedHeaders": ["*"], // presigned POST sends multipart form fields, not custom headers
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000,
  },
]
```

- `PUT` is only needed if a provider path returns `method: "PUT"` (the mock
  dev provider); the real `S3StorageProvider` uses `POST` exclusively, so a
  production bucket needs `POST` + `GET` only.
- The API never proxies file bytes; it only issues signed instructions.
- This bucket is operator-provisioned. Do not commit bucket names, keys, or a
  `render.yaml`/Terraform with real values.

---

## 13. Data ownership & future scalability

- LoadTopia owns its identity, transaction, and pricing data outright, in its own
  PostgreSQL. No core function depends on a third party holding that data.
- Append-only event and rate history is the raw material for pricing and matching
  intelligence; it is protected by convention now and can be moved to a
  partitioned / time-series store or a warehouse without touching write paths.
- Scaling path: the API is stateless (sessions in Postgres, later Redis) and
  scales horizontally; read replicas for reporting; a job/queue worker for
  notifications, tracking ingestion, and pricing snapshots; extract high-volume
  subsystems (tracking, documents) into their own services behind the same
  provider interfaces if needed.
