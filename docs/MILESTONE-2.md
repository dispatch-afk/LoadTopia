# Milestone 2 — Marketplace

LoadTopia becomes a two-sided marketplace: shippers post freight, qualified
carriers discover it, negotiate via offers/counteroffers, and one offer is
atomically awarded. Everything commercially meaningful is server-authoritative.

Baseline: `v0.2.0-m1`. This document is the M2 architecture reference; it extends
[`MILESTONE-1.md`](MILESTONE-1.md) and Phase 0 conventions without redesigning
them.

---

## Domain model

```
Company (CARRIER)  ──1:1──  CarrierProfile   (identity, capabilities, eligibility, verification)

Load (POSTED / OFFER_RECEIVED)
  └──*── OfferThread   (one negotiation per (load, carrier) — @@unique)
            ├── status: ACTIVE | ACCEPTED | REJECTED | WITHDRAWN | EXPIRED
            ├──*── OfferRound   IMMUTABLE — one row per proposal/counter
            │        { roundNumber, proposedByCompanyId, amount, currency, message, expiresAt }
            └──*── OfferEvent   IMMUTABLE append-only — CREATED / COUNTERED / ACCEPTED /
                                REJECTED / WITHDRAWN / EXPIRED

Load  ──*── PricingSnapshot   IMMUTABLE — the estimate produced for this load at a point in time
```

- **`OfferThread`** is the mutable container (its `status` is the single source of
  truth for whether a negotiation is live). `@@unique([loadId, carrierCompanyId])`
  → a carrier gets exactly one negotiation per load.
- **`OfferRound`** rows are write-once (DB trigger rejects UPDATE/DELETE). The
  latest round (`roundNumber` max) is the "current proposal"; its `expiresAt` is
  the deadline for the other party. Every prior round is retained verbatim — the
  full commercial history is never destroyed.
- **`OfferEvent`** and **`PricingSnapshot`** reuse the M1 `loadtopia_reject_mutation()`
  trigger (append-only at the database level).
- `Load.awardedOfferRoundId` / `carrierCompanyId` / `bookedRate` / `awardedAt` /
  `assignedAt` record the outcome. `bookedRate` is a direct `Decimal` copy of the
  winning round's `amount` — no floating-point arithmetic anywhere in money paths.

## Load lifecycle (extended, still one authoritative state machine)

```
DRAFT ─post→ POSTED ─first offer→ OFFER_RECEIVED ─award→ AWARDED ─assign→ CARRIER_ASSIGNED
                 └──────────────── unpost / cancel ──────────────┘
```

- `OFFER_RECEIVED` is an **explicit transition**, applied inside the
  offer-creation transaction the first time a `POSTED` load receives an offer
  (idempotent — a no-op if already `OFFER_RECEIVED`). It is *not* a state derived
  by counting offers; `loads.status` stays the sole lifecycle source of truth,
  and "active offer count" is a computed number, never a state.
- Award (`POST /api/offers/rounds/:roundId/accept` by the shipper, or a carrier
  accepting a shipper counter) transitions `OFFER_RECEIVED|POSTED → AWARDED` and
  sets `carrierCompanyId` + `bookedRate` + `awardedOfferRoundId`.
- `POST /api/loads/:id/assign` (shipper) transitions `AWARDED → CARRIER_ASSIGNED`.
- `PICKED_UP … COMPLETED` remain defined but **unexposed** (`EXPOSED_LOAD_STATUSES`)
  — M3 territory; no tracking/execution built here.
- All transitions go through the M1 atomic `LoadsService.transition()`
  (compare-and-set `updateMany where status = from`) + one immutable `load_events`
  row, inside the same transaction as the triggering action.

## Offer state machine

`OfferThread.status`: `ACTIVE → { ACCEPTED | REJECTED | WITHDRAWN | EXPIRED }` (all
terminal). Clients never PATCH status — only explicit operations:

| Operation | Endpoint | Actor | Effect |
| --- | --- | --- | --- |
| Create offer | `POST /api/marketplace/loads/:id/offers` | carrier (eligible) | new thread + round 1; `POSTED → OFFER_RECEIVED` |
| Counter | `POST /api/offers/rounds/:roundId/counter` | the party who did **not** propose the current round | new immutable round; thread stays `ACTIVE` |
| Accept | `POST /api/offers/rounds/:roundId/accept` | the party who did **not** propose the current round | **atomic award** |
| Reject | `POST /api/offers/threads/:threadId/reject` | shipper (own load) | thread → `REJECTED` |
| Withdraw | `POST /api/offers/threads/:threadId/withdraw` | carrier (own thread) | thread → `WITHDRAWN` |
| Expire | lazy, on read/action | system (`actorUserId = null`) | thread → `EXPIRED` |

## Atomic award (critical invariant)

```
one load → at most one ACCEPTED thread → one carrier assignment
```

Enforced by **both** application logic and the database:

1. Transaction takes `SELECT … FOR UPDATE` on the `loads` row.
2. Re-validates inside the lock: load status ∈ {POSTED, OFFER_RECEIVED}; the round
   is the current round of an `ACTIVE` thread on this load; not expired (a lazy
   expiry check runs first); acceptor is the correct non-proposing party with the
   right permission; the winning carrier is still eligible.
3. `updateMany({ where: { id, status: <awardable> } })` compare-and-set to
   `AWARDED` — count 0 ⇒ someone else won ⇒ `409`, whole tx rolls back.
4. Winning thread → `ACCEPTED`; **all other `ACTIVE` threads on the load →
   `REJECTED`** (`data.reason = "load_awarded_to_other"`).
5. `load_events` STATUS_CHANGED + `offer_events` ACCEPTED (winner) + REJECTED
   (losers); `audit_logs` `load.awarded`.
6. **Partial unique index** `offer_threads_one_accepted_per_load (load_id) WHERE
   status = 'ACCEPTED'` is the last-resort DB backstop.

A retried accept of the already-winning round returns `200` (idempotent); a retry
after the load was awarded elsewhere returns `409`.

## Carrier eligibility

Pure domain function `isCarrierEligibleForLoad(carrier, load)` →
`{ eligible, reasons: EligibilityReason[] }`. Checks (extensible):

`NOT_A_CARRIER`, `CARRIER_COMPANY_INACTIVE`, `PROFILE_MISSING`,
`PROFILE_NOT_ELIGIBLE`, `CARRIER_NOT_OPERATING`, `EQUIPMENT_INCOMPATIBLE`,
`SERVICE_AREA_MISMATCH`, `LOAD_NOT_ON_MARKET`, `LOAD_ALREADY_AWARDED`.

`CarrierProfile.marketplaceEligibility` (`PENDING → ELIGIBLE | INELIGIBLE |
SUSPENDED`) folds verification state into a single flag: editing the profile
resets it to `PENDING`; a passing verification (or an admin override) sets
`ELIGIBLE`. `PROFILE_NOT_ELIGIBLE` therefore also covers "not yet verified".

- The load board **hard-filters** to loads the carrier's equipment + service area
  are compatible with. Access to the board at all requires
  `CarrierProfile.marketplaceEligibility = ELIGIBLE` (else `403 CARRIER_NOT_ELIGIBLE`
  with the reasons).
- The load detail endpoint returns any market-visible load plus its per-carrier
  `eligibility` verdict (so a carrier can see *why* they can't offer).
- Offer creation and acceptance re-check eligibility server-side.
- Membership-active / permission checks are enforced at the API layer (`authenticate`
  → active company → permission), not inside the pure function.

## Marketplace visibility & privacy

- Carrier marketplace endpoints only ever return loads with
  `status ∈ {POSTED, OFFER_RECEIVED}`. DRAFT / CANCELLED / AWARDED / assigned
  loads → `404` from marketplace endpoints (never "exists but hidden").
- Shipper street addresses, phone, email, MC/DOT, pricing snapshots and
  `offeredRate` are **not** in any carrier-facing payload. Carriers see
  origin/destination **city + state**, equipment, windows, weight, commodity,
  miles, `postedAt`, and the shipper **company name** only.
- Offer privacy: a carrier sees **only its own thread(s)**; never another
  carrier's identity, amounts, counts, or existence — not through lists, detail,
  search, counts, or errors. The shipper sees every thread on its own load. Admin
  follows the existing privileged model.

## Pricing

- Existing `PricingProvider` abstraction; `[MOCK] PricingProvider` deterministic
  implementation (`isMock: true`, non-null `disclaimer`, `provider: "mock"`). No
  DAT / Truckstop / paid feed / ML — the architecture leaves room for them.
- `POST /api/pricing/estimate` — ad-hoc lane estimate (either party).
- A `PricingSnapshot` is persisted (immutable) when a shipper requests an estimate
  **for a specific load** and automatically at `POST /api/loads/:id/post`. It
  preserves amount band, currency, provider, `isMock`, timestamp, and the pricing
  inputs — so a historical price is reproducible and never silently recomputed.
- `GET /api/loads/:id/pricing` — the load's snapshots (shipper only).

## Carrier verification

- New `CarrierVerificationProvider` abstraction + `[MOCK] CarrierVerificationProvider`
  (deterministic). Its result is **never** presented as FMCSA / DOT / insurance /
  government verification: `isMock: true`, `provider: "mock"`, and a `disclaimer`
  string carried into carrier-profile + admin + health output.
- `POST /api/carrier/profile/verify` runs it; on `verified` + active authority →
  `verificationStatus = VERIFIED`, `marketplaceEligibility = ELIGIBLE`. Admin can
  override eligibility (`PATCH /api/admin/carrier-profiles/:companyId`).

## API conventions

Unchanged from M1: module = `<name>.routes.ts` + `<name>.service.ts` + serializer;
Zod `.strict()` bodies; `paginationSchema` (`page`/`pageSize`, server max) — M2
**keeps offset pagination** (sufficient for PostgreSQL-backed filtering at this
scale; the query layer is written so PostGIS / a search service can replace the
`WHERE` clause without touching the marketplace domain). Deterministic ordering on
every list (`postedAt DESC, id DESC` default). Cross-company / cross-scope → `404`.
Central error handler; no stack traces / SQL / secrets.

**Request order for every marketplace endpoint:** authenticate → resolve active
company → **permission (preHandler)** → resource scope → validate body → execute.
(M2 uses preHandler permission checks — `requirePermission` / new `requireAnyPermission`
— because the marketplace is the first surface where "passes scope" ≠ "has
permission": a shipper cannot browse the carrier board, a carrier cannot respond
to offers. This resolves the M1 audit C‑3 ordering note for the new surface.)

## Rate limiting & idempotency

Global `@fastify/rate-limit` stays. Narrow stricter limits (env-configurable,
generous enough for real dispatch volume) on the abuse-sensitive writes:
`POST …/offers` (`MARKETPLACE_WRITE_RATE_LIMIT_MAX`, default 30/min),
`…/counter` (same), `…/accept` (default 15/min). Searches use the global limit.

Idempotency is enforced by **database constraints**, not client button state:
`@@unique([loadId, carrierCompanyId])` on `OfferThread` (a double-submit → the
same thread, `200` if the payload matches, else `409`); the compare-and-set award
+ partial unique accepted index (a retried award → `200` if already won by you,
`409` otherwise).

## Auditability

`audit_logs` rows for `load.post`, `load.assign`, `pricing.snapshot`,
`offer.create`, `offer.counter`, `offer.reject`, `offer.withdraw`,
`offer.accept`, `carrier_profile.updated`, `carrier_profile.verified`,
`marketplace.eligibility.override`. The award itself is captured by
`offer.accept` + the `load_events` STATUS_CHANGED → AWARDED row. Lazy offer
**expiry** is recorded as an immutable `offer_events` `EXPIRED` row
(`actorUserId = null`), not an audit row — it is a system action with no HTTP
request behind it. No secrets/credentials in any payload; acting user recorded
where applicable.

## Frontend

- **Carrier:** `/marketplace` (board — search/filter/paginate), `/marketplace/[id]`
  (detail + eligibility + offer panel), `/marketplace/offers` ("my offers"),
  `/settings/carrier-profile` (profile + verification). Negotiation thread
  component (history + counter/withdraw/accept). Never renders another carrier's
  data.
- **Shipper:** `/loads/[id]` gains an Offers section (threads with carrier name,
  current amount, status, history, Counter/Reject/Accept, awarded carrier + final
  amount); `/loads` shows marketplace status + active-offer count; pricing snapshot
  shown on the load; "Get estimate" action.
- **Admin:** API only in M2 — `GET /api/admin/carrier-profiles`,
  `PATCH /api/admin/carrier-profiles/:companyId` (eligibility override),
  `GET /api/admin/marketplace/overview` (load/offer/profile counts + mock-flagged
  provider health). A staff web console is deferred; no analytics platform.
- Nav is permission-aware (`marketplace:browse` → "Marketplace"). UI reflects
  server state; no optimistic "it worked" before the API confirms; handles
  loading / empty / validation / auth / conflict / expired-offer / already-awarded
  / network errors.

## Out of scope (not implemented, no operational placeholders added)

GPS/driver/ETA tracking, POD, BOL/documents, payments/payouts/billing/invoices/
settlement/ledger/disputes, messaging/SMS/email infrastructure, AI matching/
negotiation/autonomous booking, DAT/Truckstop/EDI/TMS/external load-board
integrations, enterprise/public APIs, subscription billing, broker/3PL
marketplace, advanced analytics, production market-rate data feeds.
