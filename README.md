# LoadTopia

**Direct freight marketplace connecting shippers with qualified carriers.**

LoadTopia provides the technology, pricing intelligence, trust, and transaction
infrastructure that lets a shipper and a carrier transact directly — making a
broker unnecessary when the two can deal with each other.

> **Status: Milestone 3 — Operations (in closeout review).**
> On the Milestone 1 foundation and the Milestone 2 marketplace (load board,
> offers/counteroffers over an immutable round history, atomic award), an awarded
> load now runs as an operational shipment: the assigned carrier moves it
> `CARRIER_ASSIGNED → PICKED_UP → IN_TRANSIT → DELIVERED`, both parties attach
> BOL/POD/OTHER documents to **private object storage** via a two-stage direct
> upload, the shipper reviews the POD, and — only once an approved POD exists —
> closes the load out as `COMPLETED`. Manual carrier check-ins (typed city/state,
> **not** GPS) and a LoadTopia-generated **immutable Rate Confirmation** round it
> out.
> **Not built:** GPS/telematics tracking, notifications delivery, exception/dispute
> workflow, payments/payouts, real pricing/verification feeds (all provider
> abstractions with `[MOCK]` impls where relevant).
> See [`docs/MILESTONE-3.md`](docs/MILESTONE-3.md),
> [`docs/MILESTONE-2.md`](docs/MILESTONE-2.md),
> [`docs/MILESTONE-1.md`](docs/MILESTONE-1.md), and [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Architecture at a glance

| Concern     | Choice                                                                                                                                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repo        | pnpm-workspaces monorepo                                                                                                                                                                                                                                                                         |
| Backend API | Fastify 5 + TypeScript — the single authoritative source of business rules                                                                                                                                                                                                                       |
| Frontend    | Next.js 15 (App Router) — thin client, no business logic                                                                                                                                                                                                                                         |
| Database    | PostgreSQL 16                                                                                                                                                                                                                                                                                    |
| ORM         | Prisma 6 (migrations, type-safe client)                                                                                                                                                                                                                                                          |
| Auth        | Argon2id password hashing + opaque server-side sessions (httpOnly cookies)                                                                                                                                                                                                                       |
| AuthZ       | RBAC via a permission catalogue; role lives on company membership                                                                                                                                                                                                                                |
| Providers   | `RoutingProvider` (Google, DRIVE mode) + `GeocodingProvider` (Google) real; `StorageProvider` real (`S3StorageProvider`, private bucket); `PricingProvider`, `CarrierVerificationProvider`, `PaymentProvider`, `NotificationProvider`, `TrackingProvider` mock — all swappable behind interfaces |
| Testing     | Vitest (unit + integration); Fastify `inject()` for API tests                                                                                                                                                                                                                                    |
| Local infra | Docker Compose (PostgreSQL)                                                                                                                                                                                                                                                                      |

Full detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

```
apps/
  api/        Fastify REST API (authoritative backend)
  web/        Next.js frontend (thin client)
packages/
  shared/     enums, zod schemas, DTO types (web <-> api)
  domain/     business logic: load state machine, RBAC permissions & policies
  db/         Prisma schema, migrations, seed, client singleton
  providers/  external-service interfaces + mock implementations
docs/         ARCHITECTURE.md, ROADMAP.md, MILESTONE-1.md, MILESTONE-2.md, MILESTONE-3.md, SECURITY.md
```

---

## Prerequisites

- **Node.js ≥ 22** (this repo is developed on Node 24)
- **pnpm ≥ 9** (`npm i -g pnpm` or `corepack enable`)
- **Docker** (for local PostgreSQL) — or a PostgreSQL 16 you manage yourself

> **Windows on ARM (Snapdragon) note.** Docker Desktop requires WSL2
> (`wsl --install`, then reboot). Prisma ships **no Windows/ARM64 query engine**,
> so anything that talks to the database on a Windows/ARM host — `prisma migrate`,
> `prisma db seed`, the integration test suite, running the API server — must run
> in Linux: either a WSL2 shell or a container. `pnpm install`, `pnpm typecheck`,
> `pnpm lint`, `pnpm test` (unit), `pnpm build`, and `pnpm db:generate` work
> natively on Windows/ARM. CI and production containers (Linux) are unaffected.
>
> The database-backed verification for this repo was run through the API's own
> Docker image (`apps/api/Dockerfile`, `build` / `migrate` targets) against the
> Compose Postgres — see the Docker section below.

---

## Getting started

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env         # then review values

# 3. Start PostgreSQL
pnpm docker:up

# 4. Generate the Prisma client + apply migrations
pnpm db:generate
pnpm db:migrate               # first run creates the local database schema

# 5. (optional) seed clearly-labelled MOCK dev data + a working login
pnpm db:seed                  # dispatch@loadtopia.local / loadtopia-dev-password

# 6. Run the API and web app
pnpm dev                      # api on :4000, web on :3000
```

Verify:

```bash
curl -s http://localhost:4000/api/health | jq
```

Then open http://localhost:3000 and sign in. The web app reverse-proxies
`/api/*` to `API_ORIGIN` (default `http://localhost:4000`).

> **Windows/ARM:** run the database-backed workflow (migrate, seed, integration
> tests, the API server) in WSL2 or a container — Prisma ships no windows-arm64
> engine. `pnpm install`, `typecheck`, `lint`, `test` (unit), `build`, and
> `db:generate` run natively.

---

## Common tasks

| Command                    | Description                                   |
| -------------------------- | --------------------------------------------- |
| `pnpm dev`                 | Run api + web in watch mode                   |
| `pnpm test`                | Unit tests (no external dependencies)         |
| `pnpm test:integration`    | Integration tests (needs `TEST_DATABASE_URL`) |
| `pnpm typecheck`           | `tsc --noEmit` across every package           |
| `pnpm lint`                | ESLint                                        |
| `pnpm build`               | Build all packages                            |
| `pnpm db:migrate`          | Create/apply a dev migration                  |
| `pnpm db:migrate:deploy`   | Apply committed migrations (CI/prod)          |
| `pnpm db:studio`           | Prisma Studio                                 |
| `pnpm docker:up` / `:down` | Start/stop local PostgreSQL                   |

---

## Security & data ownership

- No secrets in the repo. `.env` is git-ignored; `.env.example` is the template.
- Passwords hashed with Argon2id; only SHA-256 hashes of session tokens are stored.
- Authorization is enforced **only** on the API. The web client's role checks are cosmetic.
- Append-only history: `load_events`, `market_rates`, `audit_logs`,
  `offer_rounds`/`offer_events`, `pricing_snapshots`, `document_reviews`, and the
  `rate_confirmations` commercial snapshot are never updated or deleted by
  application code (most enforced by a DB trigger) — this transaction history is
  LoadTopia's long-term competitive asset.
- Operational documents live in a **private** S3-compatible bucket; every access
  is a short-lived signed URL. Credentials never reach the browser.
- GitHub is the source of truth. Production targets owner-controlled cloud infra
  (containers + managed PostgreSQL). The project has **no** runtime dependency on
  any single PaaS.
