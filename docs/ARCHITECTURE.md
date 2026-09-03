# LoadTopia — Architecture

_Last updated: Phase 0._

This document explains the system design and the reasoning behind the significant
technology choices. It is the reference for how the codebase is meant to grow.

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

| Package               | Responsibility                                                     |
| --------------------- | ---------------------------------------------------------------- |
| `@loadtopia/shared`   | Enums, zod schemas, DTO/wire types. Imported by both api and web. |
| `@loadtopia/domain`   | Pure business logic: load state machine, RBAC permissions, resource policies. No I/O, no framework. Heavily unit-tested. |
| `@loadtopia/db`       | Prisma schema, migrations, seed, and a `PrismaClient` singleton + health probe. |
| `@loadtopia/providers`| External-service interfaces and their mock implementations + a registry/factory. |
| `@loadtopia/api`      | Fastify HTTP layer: plugins, route modules, wiring. Thin — delegates to `domain`. |
| `@loadtopia/web`      | Next.js App Router client.                                        |

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

| Plugin              | Provides                                                          |
| ------------------- | -------------------------------------------------------------- |
| `request-context`   | Per-request id (honours inbound `x-request-id`), response header, log binding. |
| `prisma`            | `app.prisma` — injectable for tests; owns disconnect when it created the client. |
| `providers`         | `app.providers` — the provider registry built from config; warns when mocks are active. |
| `security`          | helmet, CORS allowlist, cookie parsing, global rate limit.       |
| `auth`              | `app.authenticate` preHandler and `app.requirePermission(p)` factory. |

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
- **Append-only tables**: `load_events`, `market_rates`, `audit_logs`. Application
  code only ever `INSERT`s. This history is a core asset — never overwrite it.

### Entities in Phase 0

`companies`, `users`, `company_users` (membership + role), `sessions`,
`locations`, `equipment`, `lanes`, `market_rates`, `loads`, `load_events`,
`load_offers`, `audit_logs`.

Designed so that the deferred entities (`carrier_profiles`, `documents`,
`tracking_events`, `payments`, `payouts`, `invoices`, `disputes`, `api_keys`,
`integrations`, `saved_searches`, `pricing_snapshots`, `lane_statistics`,
`subscriptions`, …) attach via new tables and FKs without reshaping the core.

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
  added later as federated login *options*, not as the system of record.

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

- `CANCELLED` is reachable from any state **before** the freight is in motion
  (`DRAFT`…`CARRIER_ASSIGNED`). Once `PICKED_UP`, cancellation requires a
  dedicated exception/dispute flow (later milestone).
- `COMPLETED` and `CANCELLED` are terminal.
- The backend routes every status change through `assertLoadTransition(from,to)`
  and, in the same DB transaction, writes an **immutable `load_events` row**.
- The client can never set `status` directly — it expresses intent via specific
  endpoints (post, award, assign, …) that the API validates.

---

## 9. Provider abstraction (`packages/providers`)

Every external dependency is an interface here; application code imports only the
interface. Each response carries provenance: `{ provider, isMock, retrievedAt, metadata }`.

| Interface              | Phase 0 impl            | Future impls (examples)                     |
| ---------------------- | ----------------------- | ------------------------------------------ |
| `RoutingProvider`      | `MockRoutingProvider`   | PC*MILER, HERE, Mapbox                      |
| `PricingProvider`      | `MockPricingProvider`   | DAT, Truckstop, `LoadTopiaPricingProvider`  |
| `GeocodingProvider`    | `MockGeocodingProvider` | Mapbox, Google, US Census                   |
| `PaymentProvider`      | `MockPaymentProvider`   | Stripe, Adyen, a factoring partner          |
| `StorageProvider`      | `MockStorageProvider`   | AWS S3, GCS                                 |
| `NotificationProvider` | `MockNotificationProvider` | Postmark/SES (email), Twilio (SMS)       |
| `TrackingProvider`     | `MockTrackingProvider`  | project44, FourKites, ELD integrations      |

Rules:

- Mocks are **deterministic** and set `isMock: true`; pricing mocks also set a
  non-null `disclaimer` string that the API and UI must surface verbatim.
- `createProviderRegistry` **throws** on any non-`mock` selection until a real
  adapter is implemented — a misconfigured prod environment cannot silently serve
  synthetic data.
- No undocumented third-party APIs, no credentials, no fabricated responses in
  this repo.

### Pricing (strategic)

`PricingProvider` is intentionally minimal now. The eventual
`LoadTopiaPricingProvider` will blend external market data with LoadTopia's own
transaction history, lane statistics, equipment, distance, capacity signals,
seasonality, carrier acceptance rates, and time-to-cover — which is why
`market_rates` is append-only from day one.

---

## 10. Testing

Vitest. Layers:

| Layer               | Where                                   | Needs a DB? |
| ------------------- | -------------------------------------- | ----------- |
| Unit (domain)       | `packages/domain/**/*.test.ts`         | no          |
| Unit (providers)    | `packages/providers/**/*.test.ts`      | no          |
| Unit (shared)       | `packages/shared/**/*.test.ts`         | no          |
| Config              | `apps/api/src/__tests__/env.test.ts`   | no          |
| API (inject)        | `apps/api/src/__tests__/*.test.ts`     | no (fake Prisma) |
| Integration (E2E)   | `apps/api/src/__tests__/*.integration.test.ts` | **yes** (`TEST_DATABASE_URL`) |

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
