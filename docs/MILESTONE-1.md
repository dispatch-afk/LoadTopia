# Milestone 1 — Foundation

Shipper-side freight management. LoadTopia can now create and manage freight
internally: companies, team members, a reusable location book, equipment, and
loads with a server-authoritative lifecycle. **It is not the marketplace** —
loads are private to the owning shipper company; there is no carrier visibility,
pricing, offers, tracking, or payments.

---

## Company & membership model

```
User ──< Membership >── Company
             │
             ├─ role      SHIPPER | CARRIER | ADMIN   (role is on the membership,
             ├─ isActive                               not the user)
             └─ isPrimary                              (the "owner" membership)
```

- A user may belong to **many** companies with different roles.
- All company-owned resources (`locations`, `equipment`, `loads`, members) are
  reached **through an active membership**. There is no other ownership path.
- `POST /api/companies` creates a company and enrols the creator as a member.
- Members are added by email (`POST /api/companies/:id/members`) — the target
  user must already have a LoadTopia account (there is no invite-email flow;
  that is a notification concern, out of scope).
- Guard rails: you cannot deactivate your own membership, and a company must
  keep at least one active member.

### Active company context

The company a request acts on behalf of is **explicit and server-verified**:

- It is stored on the **session** (`sessions.active_company_id`), never taken
  from a query string, header, or request body.
- On every request, `resolveSessionContext` re-checks it against the user's
  **active** memberships. If the stored company is no longer valid (membership
  deactivated / removed) it silently falls back to the user's primary active
  membership and re-persists that on the session.
- `POST /api/auth/switch-company { companyId }` verifies the target is an active
  membership of the caller before switching; otherwise `404`.
- `GET /api/auth/me` returns `{ user, memberships, activeCompanyId, role, permissions }`.

Designed so nothing changes architecturally as more users become multi-company.

---

## Authorization

RBAC via the Phase 0 permission catalogue (`packages/domain/src/authz`). Routes
check **permissions**, never role strings.

| Role | Highlights |
| ---- | ---------- |
| `SHIPPER` | company + members + locations + equipment + **loads** (create/read/update/delete/post/cancel) for the active company |
| `CARRIER` | company + members + locations + equipment for the active company. **No load access at all** in Milestone 1. |
| `ADMIN` | all permissions; not company-scoped |

Every protected endpoint runs, in order: **authenticate → resolve active
company → verify membership/permission → verify resource scope → validate body →
execute**. Cross-company resource access returns **`404`** (not `403`) so a
caller cannot probe for another company's data by iterating UUIDs (`GET`, `PATCH`,
`DELETE`, and every `/loads/:id/*` action).

---

## Locations (company location book)

`Location` is now first-class and company-scoped (`companyId` is `NOT NULL`,
`ON DELETE RESTRICT`).

- Create / list / read / update / soft-delete (`isActive`), all scoped to the
  active company.
- On create and on any address change, the address is geocoded through the
  **`GeocodingProvider`** abstraction (mock in dev — coordinates are flagged
  `geocodedBy: "mock"` and `isGeocoded`). Coordinates feed routing.
- `DELETE` deactivates (soft). A location referenced by a non-terminal load
  cannot be removed (`409`). Historical loads keep their location reference.

---

## Equipment

Company-scoped carrier equipment records: `type` (9 values incl. `CONESTOGA`,
`BOX_TRUCK`, `HOTSHOT`, `OTHER`), optional `name`, `trailerLengthFt`,
`capacityLbs`, `description`, `isActive`. `DELETE` deactivates. CHECK constraints
enforce non-negative capacity / positive length.

---

## Loads

### Numbering

`referenceNumber = {prefix}-{00001}` where `prefix` is a company-unique 2–8 char
token derived from the company name (`companies.load_number_prefix`, globally
unique). The per-company counter `companies.load_sequence` is incremented under a
row lock **inside the create-load transaction**, so numbers are gap-free per
company and globally unique with no retry loop. Never client-supplied.

### Validation (server-side)

Zod shape validation + the domain validator `validateLoadWindows` /
`validatePostReadiness`, echoed by DB CHECK constraints:

- origin ≠ destination; both locations must belong to the active company
- `weightLbs > 0`
- window end ≥ window start (pickup and delivery)
- delivery may not start before pickup starts
- to **post**: origin, destination, equipment, commodity, weight, and both full
  windows are required

### Lifecycle (server-authoritative)

```
DRAFT ⇄ POSTED          both may go to → CANCELLED (terminal)
```

Milestone 1 exposes only the shipper-side portion of the broader state machine
(`packages/domain/src/load/load-state-machine.ts` still defines the full graph
for later milestones). Clients **cannot** set `status` — `create`/`update` reject
a `status` key (strict schema). Status only changes through explicit endpoints:

| Endpoint | Transition |
| -------- | ---------- |
| `POST /api/loads/:id/post` | `DRAFT → POSTED` (requires post-readiness) |
| `POST /api/loads/:id/unpost` | `POSTED → DRAFT` (withdraw to edit) |
| `POST /api/loads/:id/cancel` | `→ CANCELLED` (optional reason) |

Every transition is applied in a transaction that re-checks the current status
(optimistic concurrency) and writes an immutable `load_events` row.
`PATCH`/`DELETE` are refused on a non-`DRAFT` load (`409`) — withdraw or cancel
instead. `DELETE` hard-deletes a `DRAFT` load (and its single `CREATED` event).

### Routing

On create, and on any origin/destination/equipment change, `computeRouting`
calls the **`RoutingProvider`** abstraction with the two geocoded points and
stores `distanceMeters`, `driveTimeMinutes`, `routingProvider`, `routedAt`. The
API exposes `miles` (derived) and `driveTimeMinutes`. If a location is not
geocoded or the provider errors, the load is still created — mileage is left
`null` and a warning is logged. Mock routing responses are flagged `isMock: true`
and never presented as real-world data.

### Immutable events

`load_events` is append-only, enforced by a **database trigger**
(`load_events_append_only`): every `UPDATE` is rejected, and every `DELETE` is
rejected **except** inside a transaction that opts in via
`SET LOCAL "loadtopia.allow_event_delete" = 'on'` — done only by the
delete-a-DRAFT-load path so the cascade can remove the `CREATED` event. A direct
`prisma.loadEvent.update()/delete()` throws. (`audit_logs` immutability remains
by-convention, unchanged from Phase 0.)

---

## Database changes

New migration: `packages/db/prisma/migrations/20260904120000_m1_foundation`.

| Table | Change |
| ----- | ------ |
| `companies` | + address/contact columns; + `load_number_prefix` (unique) & `load_sequence` (backfilled) |
| `company_users` | + `is_active`; + `(user_id, is_active)` index |
| `sessions` | + `active_company_id` FK (`ON DELETE SET NULL`) + index |
| `locations` | `region`→`state`, `label`→`name`; + `provider_place_id`, `geocoded_by`, `is_active`; `company_id` now `NOT NULL` + FK `RESTRICT`; reindexed |
| `equipment` | + `name`, `trailer_length_ft`, `capacity_lbs`, `is_active`; FK → `RESTRICT`; + 2 CHECKs; reindexed |
| `loads` | + `mode` (`TransportMode`), `drive_time_minutes`, `routing_provider`, `routed_at`, `updated_by_user_id` FK; + `(shipper_company_id, created_at)` index; + 5 CHECKs |
| `load_events` | + `load_events_append_only` trigger |
| enums | + `TransportMode`; `EquipmentType` += 4 values; `LoadEventType` += `UPDATED` |

Pricing placeholders (`lanes`, `market_rates`, `load_offers`, `loads.offered_rate`
etc.) are **retained and untouched** — not populated or exposed.

---

## Local development

```bash
pnpm install
pnpm docker:up                       # PostgreSQL 16
pnpm db:generate && pnpm db:migrate  # apply init + m1_foundation
pnpm db:seed                         # optional [MOCK] data + a working login
pnpm dev                             # api :4000, web :3000
```

Seeded login: `dispatch@loadtopia.local` / `loadtopia-dev-password`.

The web app proxies `/api/*` to the API (`API_ORIGIN`, default
`http://localhost:4000`) so the session cookie is first-party in every
environment — this mirrors the production edge/load-balancer split.

> On Windows/ARM run the DB-backed workflow (migrate, seed, integration tests,
> the API server) inside WSL2 or a container — Prisma has no windows-arm64
> engine. Unit tests, typecheck, lint, `prisma generate`, and the web/API
> builds run natively.
