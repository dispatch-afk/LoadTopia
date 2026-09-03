# Milestone 2 — Verification Report

Branch: `milestone/2-marketplace` · Baseline: `v0.2.0-m1` (commit `f66542b`)
**Not merged. Not tagged.** 10 logical commits, 78 files, +6026 / −175.

---

## 1. What was built

A complete direct-marketplace loop on top of the M1 foundation, server-authoritative
throughout. Full design: [`MILESTONE-2.md`](MILESTONE-2.md).

| Area | Delivery |
| --- | --- |
| **DB schema** | `carrier_profiles`, `offer_threads`, `offer_rounds` (immutable), `offer_events` (immutable), `pricing_snapshots` (immutable); `loads` + award columns & indexes; 5 new enums; `load_offers` / `OfferStatus` removed. One migration `20260905120000_m2_marketplace`. Append-only enforced by the M1 `loadtopia_reject_mutation()` trigger on all three immutable tables + a partial-unique `offer_threads_one_accepted_per_load`. |
| **Domain** (`packages/domain/marketplace`) | Pure, framework-free: `isCarrierEligibleForLoad` / `carrierMarketplaceAccess`, offer-thread state machine, negotiation turn-taking, lazy expiration helpers, `assertAwardable`. Load state machine extended `DRAFT→POSTED→OFFER_RECEIVED→AWARDED→CARRIER_ASSIGNED`; `PICKED_UP…COMPLETED` kept unexposed. |
| **Providers** | New `CarrierVerificationProvider` abstraction + `[MOCK]` deterministic impl. All mock providers carry `isMock:true`, `provider:"mock"`, a verbatim disclaimer, and a `[MOCK] …` health message. The mock verification disclaimer explicitly states it is **NOT FMCSA / DOT / SAFER / insurance / government** verification. |
| **API** | `carrier/`, `pricing/`, `marketplace/`, `offers/`, `admin/` modules. Carrier profile CRUD + verify; pricing estimates + immutable snapshots (auto at post time); carrier load board + detail (hard equipment/service-area filter, deterministic ordering, offset pagination); offers → counter → accept/reject/withdraw with lazy expiry; **atomic load award**; `AWARDED→CARRIER_ASSIGNED` assign; admin eligibility override + overview. Per-op rate limits (`MARKETPLACE_WRITE_*` 30/min, `MARKETPLACE_AWARD_*` 15/min). |
| **Web** | Carrier: `/marketplace` board, `/marketplace/[id]` detail + offer panel, `/marketplace/offers`, `/settings/carrier-profile`. Shipper: `/loads/[id]` gains Offers (negotiation threads, counter/accept/reject, awarded carrier + final amount, assign), pricing snapshots, "Get estimate". Permission-aware nav; new status badges. |
| **Seed** | Adds a `[MOCK]` carrier company (`driver@loadtopia.local`) with an ELIGIBLE profile and a POSTED load so the marketplace is explorable immediately. |

## 2. Key design decisions

- **`OFFER_RECEIVED` is an explicit transition**, applied inside the offer-creation
  transaction (idempotent). `loads.status` stays the single lifecycle source of
  truth; "active offer count" is a computed number, never a state.
- **Atomic award** = `SELECT … FOR UPDATE` on the load + re-checked pure
  preconditions inside the lock + compare-and-set `updateMany where status ∈
  {POSTED, OFFER_RECEIVED}` (count 0 → 409, tx rolls back) + auto-reject of all
  other `ACTIVE` threads + partial-unique DB backstop. Two carriers accepting
  concurrently can never both win.
- **Offer history is immutable at the DB level** (`OfferRound` / `OfferEvent`
  reject UPDATE/DELETE via trigger). The final accepted amount is unambiguous:
  `loads.bookedRate` is a `Decimal` copy of the winning round's `amount`, and
  `loads.awardedOfferRoundId` points at the exact round.
- **Offset pagination kept** (documented); the marketplace `WHERE` is isolated in
  the service so a PostGIS/search backend can replace it without touching the
  domain.
- **Reused the M1 pattern**, not a second one: `lib/load-lifecycle.ts` extracts
  the M1 atomic-transition + event-append helpers so the offers module drives
  load transitions the same way `LoadsService` does.
- No architectural conflict with M1 was found, so the plan was not sent for
  approval (per the brief).

## 3. Verification results

### Ran and passing (native, this machine)

| Check | Result |
| --- | --- |
| `pnpm typecheck` (6 packages) | ✅ pass |
| `pnpm lint` (eslint) | ✅ pass, 0 warnings |
| `pnpm test` (unit) | ✅ **115 pass** — domain 82 (46 new marketplace), api 21, shared 6, providers 6 (2 new) |
| `pnpm --filter @loadtopia/api build` (tsup) | ✅ pass |
| `pnpm --filter @loadtopia/web build` (next build) | ✅ pass — all marketplace routes compile |
| `prisma migrate status` (test DB, earlier this session) | ✅ "Database schema is up to date!" (3 migrations) — confirms M2 applies on top of M1 |
| `prisma migrate deploy` on a fresh DB + `migrate diff --exit-code` (prior session) | ✅ clean apply (init+m1+m2), "No difference detected" (no drift) |

### Written but NOT executed on this machine — Docker is required and unavailable

Docker Desktop on this Windows host **fails to start** ("Error response from daemon:
Docker Desktop is unable to start"), and this machine has no native Prisma query
engine (arch mismatch — the established constraint), so the following could not be
run here. They are covered by CI (`.github/workflows/ci.yml`, ubuntu-latest with a
Postgres service, where the Prisma engine runs natively):

| Check | Status |
| --- | --- |
| **Integration suite** `pnpm --filter @loadtopia/api test:integration` | ⏳ `marketplace.integration.test.ts` **written** (25 cases) + typechecks; M1 suites unchanged. Not run here. |
| Docker image builds (`--target build` / runtime / migrate) | ⏳ not run here |
| Runtime `/health` `/health/live` `/health/ready` against a container | ⏳ not run here |
| Fresh-DB migration re-verification | ⏳ DB went down with Docker; last status was clean |

`marketplace.integration.test.ts` covers: verification pass/fail → eligibility;
board visibility (POSTED only, never DRAFT/private) + equipment/service-area hard
filter; `403 CARRIER_NOT_ELIGIBLE` gate; offer create → `OFFER_RECEIVED` + events;
idempotent first offer; counteroffer immutable history + turn-taking + stale-round
rejection; carrier cannot see another carrier's thread, shipper sees all; accept →
atomic award + auto-reject losers + assign; award-twice → 409; expired offer → 409
`OFFER_EXPIRED`; cross-company counter/accept → 404; shipper-cannot-offer → 403;
**concurrency** (concurrent awards → one winner + one `AWARDED` event; concurrent
duplicate first offers → one thread/round; concurrent counters → one wins, linear
history); DB-level `offer_rounds` / `offer_events` immutability; admin override +
overview.

**To run it** once Docker is healthy (or on any Linux host with Postgres):

```bash
docker compose up -d
pnpm --filter @loadtopia/db migrate:deploy
pnpm --filter @loadtopia/api test:integration
```

## 4. Security self-review (findings + fixes)

Reviewed authentication, authorization (carrier/shipper/admin/cross-company),
IDOR, commercial integrity, concurrency, and data leakage against the M2 attack
surface. Findings fixed in this branch:

- **Cross-boundary PII in offer events** — `OfferEventView.actorName` / `actorUserId`
  exposed the *individual* on the other side of a negotiation. Now redacted: each
  party sees only the acting *side*; the person's name is shown to their own side
  (and admin) only. (`dd8417d`)
- **New domain error codes** (`NEGOTIATION_RULE`, `INVALID_OFFER_TRANSITION`) were
  only handled by the generic fallback; registered them explicitly. `AwardError`'s
  dynamic codes (`LOAD_ALREADY_AWARDED`, `OFFER_EXPIRED`, …) intentionally ride the
  fallback — they carry a numeric `statusCode` and serialize as `{code, message}`
  with no stack/SQL. (`dd8417d`)

Verified no regression on:

- IDOR — DRAFT/private/awarded loads are `404` from every marketplace/offer
  endpoint; round/thread IDs outside the caller's scope → `404`, never a probe
  signal.
- Commercial integrity — cannot accept another carrier's offer, an
  expired/rejected/withdrawn offer, or an already-awarded load; cannot counter as
  the proposing party; rounds are immutable so amounts can't change post-accept;
  no direct status manipulation (no generic PATCH).
- Data leakage — carrier never sees another carrier's identity/amounts/counts/
  existence (enforced by query scoping, not just serializers); no shipper street
  address / phone / email / MC-DOT / pricing snapshots in any carrier payload;
  provider responses carry no secrets; `<500` errors never emit stack/SQL, `500`s
  emit only a generic message.
- Concurrency — see §2; the mandatory concurrent-award test asserts the invariant
  *one load → ≤1 ACCEPTED thread → one carrier assignment*.

## 5. Known limitations / deferred (by design)

- Admin is **API-only** in M2 (no staff web console).
- Offer expiration is **lazy** (on read/action); the helpers are shaped for a
  future BullMQ/cron worker with no domain change.
- Carrier verification, pricing, and market rates are **`[MOCK]`** — deterministic
  development data, never presented as real. No DAT/Truckstop/FMCSA/EDI/TMS.
- No tracking, documents, payments/payouts, messaging infra, saved searches, or
  matching/ranking (later milestones).

## 6. Compliance with the brief

- ✅ Worked only on `milestone/2-marketplace`; **not merged to `main`**, **no M2
  tag**, branch intact.
- ✅ M1 behavior preserved — M1 unit tests unchanged and passing; M1 integration
  suites untouched (only the shared test-harness `TABLES` list updated for the
  new/renamed tables, and two M1 unit assertions that hard-coded the 7-provider
  list → 8).
- ✅ Proper Prisma migration; mock providers unmistakable; no mock data presented
  as live; no later-milestone functionality.
- ⚠️ Docker-dependent verification (integration tests, image builds, runtime
  health) could not be executed on this machine — Docker Desktop will not start.
  CI covers all of it.
