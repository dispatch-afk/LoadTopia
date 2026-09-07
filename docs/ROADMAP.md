# LoadTopia — Roadmap

High-level milestone plan. Each milestone is authorized separately. Milestones 0–3
are built; Milestone 3 is in closeout review.

> **Resequencing note.** Milestone 3 was changed from "Pricing Intelligence" to
> **Operations** (post-award execution, manual check-ins, operational documents,
> POD review, Rate Confirmation, completion). Pricing Intelligence and
> booking/rate-lock notifications move to Milestone 4. Tracking/telematics and
> payments keep their later slots.

---

## Milestone 0 — Foundation ✅

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

## Milestone 2 — Marketplace: discovery, offers & award ✅

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

## Milestone 3 — Operations ✅ (in closeout review)

Turns an awarded load into an operational shipment. See
[`MILESTONE-3.md`](MILESTONE-3.md).

- ✅ **Post-award lifecycle exposed**: `CARRIER_ASSIGNED → PICKED_UP → IN_TRANSIT
→ DELIVERED → COMPLETED` via explicit carrier intent endpoints
  (`/pickup`, `/in-transit`, `/deliver`) + shipper `/complete`. `EXPOSED_LOAD_STATUSES`
  now covers all ten statuses. Operational timestamps set once, never rewritten.
- ✅ **Carrier operational authorization** (`canOperateShipment` +
  `SHIPMENT_OPERATE_ASSIGNED`) — the assigned carrier company only, from
  `CARRIER_ASSIGNED` on. `canModifyLoad` (shipper-only) untouched.
- ✅ **Manual check-ins** (`load_check_ins`) — carrier-typed city/state (+ optional
  reported coordinates). Server-authoritative `recorded_at`. **Not** GPS /
  telematics / live tracking. Append-only; one `CHECK_IN_ADDED` event each.
- ✅ **Operational documents** (BOL / POD / OTHER) — two-stage request → direct
  browser upload to private object storage → confirm (strict size/type equality
  against the authorized intent). Shipper **or** assigned carrier may upload.
  25 MiB (26,214,400 bytes) exact cap; PDF/JPEG/PNG only.
- ✅ **Shipper POD review** — `approve` / `reject`-with-reason over an immutable
  `document_reviews` trail (one terminal decision per POD).
- ✅ **Replacement POD** for a rejected POD (new row; original retained, immutable).
- ✅ **Safe removal** — soft only, uploader's company only, **never a reviewed POD**.
- ✅ **Completion readiness** — `DELIVERED → COMPLETED` gated by an active
  **approved** POD (a pure DB check; no storage call).
- ✅ **Rate Confirmation** — LoadTopia-generated immutable commercial snapshot
  written inside the award transaction; best-effort post-commit PDF render to a
  private `StorageProvider`; authorized retrieval derived from the owning load;
  historical pre-M3 awards return `RATE_CONFIRMATION_NOT_AVAILABLE` (never a
  fabricated snapshot).
- ✅ **Immutable events with actor-company attribution** (`load_events.actor_company_id`).
- ✅ **Operational frontend** — shipper `/loads/[id]` and carrier
  `/marketplace/[id]` gain progress / check-ins / documents / POD review / Rate
  Confirmation / completion, inside the existing app shell.
- **Deliberately deferred** (schema headroom only, no endpoint/UI): exception /
  delay reporting (`EXCEPTION_REPORTED` enum), notification delivery
  (`NotificationProvider` stays mock), a dedicated admin operational console.

## Milestone 4 — Pricing intelligence + tracking

- Real `PricingProvider` data agreement (replace `[MOCK]`), rate-band surfacing
  refinements, `lane_statistics` aggregation from `load_events` + `market_rates`.
- Booking confirmation + rate-lock UX; notifications via `NotificationProvider`.
- `tracking_events` / `carrier_locations` ingested via `TrackingProvider`
  (automated position updates alongside the M3 manual check-ins).

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
