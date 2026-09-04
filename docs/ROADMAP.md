# LoadTopia — Roadmap

High-level milestone plan. Each milestone is authorized separately. Milestones 0–2
are built; Milestone 2 is in review.

---

## Milestone 0 — Foundation ✅ (this phase)

Monorepo, database schema + initial migration, auth (Argon2id + server-side
sessions), RBAC + resource policies, provider interfaces with mock
implementations, health endpoint, structured logging, test harness, CI, docs.

**Explicitly not included:** marketplace, load creation, pricing, matching,
offers, booking, tracking, documents, payments.

---

## Milestone 1 — Companies, users, and loads (CRUD, no marketplace) ✅

- ✅ Company profile + team management; membership-based authorization; active
  company context on the session; `POST /api/auth/switch-company`.
- ✅ Location book with geocoding via `GeocodingProvider`.
- ✅ Equipment records.
- ✅ **Load CRUD + lifecycle**: `DRAFT ⇄ POSTED → CANCELLED` via intent
  endpoints; every transition writes an immutable `load_events` row
  in-transaction; append-only enforced by a DB trigger.
- ✅ Route distance/drive time via `RoutingProvider` on create + relevant edits.
- ✅ Authorization enforced server-side; cross-company access → 404 (IDOR);
  audit logging on mutations.
- ✅ Integration test coverage of the lifecycle, authz, and IDOR.

Loads are private to the shipper company — no carrier visibility. See
[`MILESTONE-1.md`](MILESTONE-1.md).

## Milestone 2 — Marketplace: discovery, offers & award ✅ (in review)

Scope grew to a complete transact-directly loop (see [`MILESTONE-2.md`](MILESTONE-2.md)):

- ✅ Carrier marketplace profile (identity, equipment, service area) + carrier
  authority/insurance **verification abstraction** (`CarrierVerificationProvider`,
  `[MOCK]` impl — never presented as FMCSA/DOT/insurance/government).
- ✅ Server-authoritative eligibility + carrier load board (`marketplace:browse`)
  with lane/equipment/date/weight/distance filters, deterministic ordering,
  offset pagination.
- ✅ Offers + counteroffers over an **immutable `OfferRound` history**
  (`OfferThread` state machine: `ACTIVE → ACCEPTED|REJECTED|WITHDRAWN|EXPIRED`),
  append-only `offer_events`, server-authoritative lazy expiration.
- ✅ **Atomic load award** (`SELECT … FOR UPDATE` + compare-and-set + partial
  unique backstop) → `DRAFT → POSTED → OFFER_RECEIVED → AWARDED → CARRIER_ASSIGNED`.
- ✅ `PricingProvider` estimates + **immutable `PricingSnapshot`s** (auto at post
  time; reproducible, never silently recomputed).
- ✅ Admin eligibility override + marketplace overview.
- Deferred: saved searches, richer matching/ranking, booking confirmation
  notifications via `NotificationProvider`, `lane_statistics` aggregation.

## Milestone 3 — Pricing intelligence (v1)

- Real `PricingProvider` data agreement (replace `[MOCK]`), rate-band surfacing
  refinements, `lane_statistics` aggregation from `load_events` + `market_rates`.
- Booking confirmation + rate-lock UX; notifications via `NotificationProvider`.

## Milestone 4 — Execution, tracking, documents

- `tracking_events` / `carrier_locations` ingested via `TrackingProvider`.
- Status updates (`PICKED_UP` → `IN_TRANSIT` → `DELIVERED`).
- `documents` (rate confirmation, BOL, POD) via `StorageProvider` (signed URLs).
- Proof of delivery capture → `COMPLETED`.

## Milestone 5 — Payments & payouts

- `PaymentProvider` (real): shipper charge on booking/delivery.
- Carrier `payouts`, `invoices`, `fees`, `transactions`.
- Disputes.

## Milestone 6 — Enterprise & platform

- `api_keys` + `API_CLIENT` role; public REST API + webhooks (`integrations`).
- `ENTERPRISE_ADMIN`, `DISPATCHER`, `DRIVER`, `ACCOUNTING`, `OPERATIONS_MANAGER` roles.
- `subscriptions` / billing plans.

## Milestone 7 — LoadTopia intelligence

- `LoadTopiaPricingProvider` blending market data + proprietary transaction
  history, acceptance rates, time-to-cover, seasonality.
- Automated matching and pricing recommendations; groundwork for AI automation.

---

## Cross-cutting (ongoing)

Observability (metrics/tracing/dashboards), security reviews, load/perf testing,
accessibility, i18n readiness, backups + disaster-recovery drills, data-retention
policy for PII vs. append-only history.
