# LoadTopia — Roadmap

High-level milestone plan. Each milestone is authorized separately. Nothing past
Milestone 0 is built yet.

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

## Milestone 2 — Marketplace & discovery

- Carrier-facing load board (`marketplace:browse`) with filters (lane, equipment,
  date, weight) and saved searches.
- Carrier profile + equipment/lane preferences.
- Basic matching: surface relevant loads to carriers.

## Milestone 3 — Pricing intelligence (v1)

- `pricing_snapshots` captured at post time and at booking.
- `PricingProvider` wired into load posting to show a rate band (still mock until
  a real data agreement exists — clearly labelled).
- `lane_statistics` aggregation job from `load_events` + `market_rates`.

## Milestone 4 — Offers, counteroffers, booking

- `load_offers` with the counteroffer chain (`parent_offer_id`).
- Offer lifecycle → load `AWARDED` / `CARRIER_ASSIGNED`.
- Booking confirmation + rate lock; notifications via `NotificationProvider`.

## Milestone 5 — Execution, tracking, documents

- `tracking_events` / `carrier_locations` ingested via `TrackingProvider`.
- Status updates (`PICKED_UP` → `IN_TRANSIT` → `DELIVERED`).
- `documents` (rate confirmation, BOL, POD) via `StorageProvider` (signed URLs).
- Proof of delivery capture → `COMPLETED`.

## Milestone 6 — Payments & payouts

- `PaymentProvider` (real): shipper charge on booking/delivery.
- Carrier `payouts`, `invoices`, `fees`, `transactions`.
- Disputes.

## Milestone 7 — Enterprise & platform

- `api_keys` + `API_CLIENT` role; public REST API + webhooks (`integrations`).
- `ENTERPRISE_ADMIN`, `DISPATCHER`, `DRIVER`, `ACCOUNTING`, `OPERATIONS_MANAGER` roles.
- `subscriptions` / billing plans.

## Milestone 8 — LoadTopia intelligence

- `LoadTopiaPricingProvider` blending market data + proprietary transaction
  history, acceptance rates, time-to-cover, seasonality.
- Automated matching and pricing recommendations; groundwork for AI automation.

---

## Cross-cutting (ongoing)

Observability (metrics/tracing/dashboards), security reviews, load/perf testing,
accessibility, i18n readiness, backups + disaster-recovery drills, data-retention
policy for PII vs. append-only history.
