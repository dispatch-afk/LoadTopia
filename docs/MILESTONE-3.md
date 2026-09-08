# Milestone 3 — Operations

An awarded load becomes an operational shipment: the assigned carrier moves it
through pickup → in transit → delivered, both parties attach evidence
(BOL / POD / OTHER), the shipper reviews the POD, and — only once an approved POD
exists — the shipper closes the load out as `COMPLETED`. A LoadTopia-generated,
immutable **Rate Confirmation** commercial snapshot is produced at award time.

Baseline: `v0.2.0-m2`. This document extends [`MILESTONE-1.md`](MILESTONE-1.md)
and [`MILESTONE-2.md`](MILESTONE-2.md) and the Phase 0 conventions in
[`ARCHITECTURE.md`](ARCHITECTURE.md) without redesigning them.

> **Roadmap note.** Milestone 3 was resequenced from "Pricing Intelligence" to
> "Operations" (post-award execution + documents). Pricing Intelligence and
> `NotificationProvider`-backed notifications move to a later milestone. See
> [`ROADMAP.md`](ROADMAP.md).

---

## What Milestone 3 is not

No GPS / ELD / telematics tracking (check-ins are **manually typed**, never a
device fix). No payments, payouts, invoicing, or settlement — `COMPLETED` is
operational truth only. No exception / dispute / claims workflow (the
`EXCEPTION_REPORTED` enum value exists as reserved schema headroom; there is no
endpoint, service, or UI for it). No notification delivery — `NotificationProvider`
stays mock. No new admin surface — admin authorization already spans operational
data through the existing load endpoints. No real pricing feed —
`PricingProvider` stays mock. Google routing stays `travelMode: DRIVE`.

---

## Load lifecycle (now fully exposed)

```
DRAFT → POSTED → OFFER_RECEIVED → AWARDED → CARRIER_ASSIGNED
      → PICKED_UP → IN_TRANSIT → DELIVERED → COMPLETED
```

- `EXPOSED_LOAD_STATUSES` now contains all ten statuses; `PICKED_UP … COMPLETED`
  are live.
- **Carrier movement** — `POST /api/loads/:id/pickup`, `/in-transit`, `/deliver`.
  Explicit intent endpoints, never a generic status PATCH. Authorized by
  `canOperateShipment` + `SHIPMENT_OPERATE_ASSIGNED`: the assigned carrier
  company only, and only once the load has actually reached `CARRIER_ASSIGNED`
  (the pre-assignment `AWARDED` window is excluded). The owning shipper cannot
  perform these.
- **Shipper completion** — `POST /api/loads/:id/complete` (`DELIVERED → COMPLETED`),
  shipper-only (`load:update:own`, like `/assign`), gated by
  `assertCompletionReadiness()` inside the transaction.
- `picked_up_at` / `delivered_at` / `completed_at` are set once, never rewritten.
  There is deliberately no `in_transit_at` column and none is fabricated.
- Every transition goes through the M1 atomic `atomicLoadTransition()`
  (compare-and-set `where status = from`) + one immutable `load_events` row in
  the same transaction, now carrying `actor_company_id` so a carrier-authored
  and a shipper-authored event are distinguishable on one timeline.
- `POST /api/loads/:id/post` is **DRAFT-only**. The state machine also defines
  the reserved `OFFER_RECEIVED/AWARDED → POSTED` edge, but no endpoint drives it
  and `/post` explicitly refuses any non-`DRAFT` status (Slice 8 closeout — the
  domain transition map is unchanged; only the endpoint and the client-facing
  `availableTransitions` were tightened).

### Actor-aware `availableTransitions`

`LoadView.availableTransitions` is filtered to the transitions **this viewer**
could actually trigger: a shipper never sees `PICKED_UP/IN_TRANSIT/DELIVERED`, an
assigned carrier never sees `COMPLETED`, and the reserved `→ POSTED` edge is
shown to no one. `LoadView.completionReady` is the separate **objective** fact
(`DELIVERED` + an active approved POD) — true for both parties when the load is
genuinely ready; only the shipper is _offered_ the action.

---

## Manual check-ins

`load_check_ins` — a carrier-typed `{ city, state, note?, latitude?, longitude? }`
observation. Not GPS, not telematics, not a verified position.

- `GET /api/loads/:id/check-ins` — any authorized load reader (owning shipper,
  assigned/winning carrier, admin), chronological (`recorded_at ASC, id ASC`).
- `POST /api/loads/:id/check-ins` — assigned carrier only
  (`SHIPMENT_OPERATE_ASSIGNED` + `canOperateShipment`), only while the load is
  `CARRIER_ASSIGNED … DELIVERED`.
- `recorded_at` is **server-authoritative** (one `now` captured inside the
  transaction, after the load row-lock + re-validation). The client cannot send
  `loadId`, `actorUserId`, `actorCompanyId`, `recordedAt`, or `createdAt`
  (`.strict()` schema).
- Coordinates are optional, both-or-neither, range-checked, and never derived
  from `city/state`.
- Append-only: no PATCH, no DELETE. Each `POST` writes exactly one
  `CHECK_IN_ADDED` `load_events` row in the same transaction.

---

## Operational documents (BOL / POD / OTHER)

`load_documents` — user-submitted evidence. The Rate Confirmation is **not** a
row here; it is a separate system-generated record.

### Two-stage upload

1. `POST /api/loads/:id/documents` — authorize, validate, allocate a document id
   and a **server-generated** object key `loads/{loadId}/documents/{documentId}`,
   sign a direct-to-storage upload, and persist an **unconfirmed** row
   (`confirmed_at IS NULL`). An unconfirmed row is invisible to every
   list/read/review/completion path.
2. The browser uploads the bytes **directly to object storage** using the signed
   instructions verbatim (presigned POST for the real provider).
3. `POST /api/load-documents/:documentId/confirm` — `headObject` the stored
   object and enforce, against the authorized intent: exists, non-empty,
   `contentLength ≤ 26_214_400` **and exactly equal** to the declared
   `size_bytes` (strict equality, no tolerance), content-type match. Only then
   flip `confirmed_at` (and, for a POD, `review_status = PENDING_REVIEW`) and
   write one `DOCUMENT_UPLOADED` event.

`MAX_OPERATIONAL_DOCUMENT_BYTES = 26_214_400` (25 MiB exactly — the binary
value, enforced at the API layer and in the presigned-POST
`content-length-range`). MIME allowlist: `application/pdf`, `image/jpeg`,
`image/png`. `POST /api/loads/:id/documents` has a dedicated per-user rate limit
(`DOCUMENT_UPLOAD_RATE_LIMIT_MAX`, default 30/min).

### Upload authorization (both parties)

`canUploadOperationalDocument` — the owning **shipper** (with `load:update:own`)
**or** the assigned **carrier** company (with `shipment:operate:assigned`, load
not `AWARDED`) **or** admin. This is a document-specific boundary; it does not
grant the shipper any status-transition or check-in ability, and
`canModifyLoad` is untouched.

`canManageOwnOperationalDocument` (confirm / soft-remove) additionally requires
company-scope **and** that the actor holds the same upload permission for that
company side — membership alone is not sufficient.

### Downloads

`GET /api/load-documents/:documentId/download` — for a confirmed, non-removed
document whose object storage confirms the file is present, returns a fresh
short-lived signed URL (`DOCUMENT_OBJECT_MISSING` 409 if the object is gone —
never a dead link). The web client requests a new URL per click and never
persists it.

### POD review

`document_reviews` — **immutable** (`loadtopia_reject_mutation` trigger blocks
UPDATE/DELETE; `document_id` is `UNIQUE`). One terminal decision per POD.

- `POST /api/load-documents/:documentId/approve` / `/reject` — owning **shipper**
  only (`load:update:own`; carriers lack it). Reject requires a non-empty reason.
- `PENDING_REVIEW → {APPROVED, REJECTED}`, both terminal.
- A `DOCUMENT_REVIEWED` `load_events` row is written in the same transaction.

### Replacement POD

A `REJECTED` POD may be replaced: `POST /api/loads/:id/documents` with
`replacedDocumentId = <rejected POD id>`. The replacement is a **new** row
(`replaces_document_id` set); the rejected original stays visible and immutable.
The reference is valid only for a confirmed, non-removed, `REJECTED` POD on the
**same** load.

### Retention & removal

`DELETE /api/load-documents/:documentId` — soft-remove (`removed_at`), uploader's
own company only, only while the load is non-terminal. **A reviewed
(`APPROVED` or `REJECTED`) POD can never be removed, by anyone** — it is
permanent evidence. Removal is always soft; no row is ever physically deleted
and the storage object is left intact. One `DOCUMENT_REMOVED` event per removal.

### Completion readiness

`assertCompletionReadiness()` is a **pure database check**: same load,
`doc_type = POD`, `confirmed_at IS NOT NULL`, `review_status = APPROVED`,
`removed_at IS NULL`, `LIMIT 1`. It makes **no** `StorageProvider` call — a
later S3 outage does not prevent `DELIVERED → COMPLETED` when an active approved
POD exists.

---

## Rate Confirmation

A LoadTopia-generated commercial record for an awarded load — a **read of an
immutable snapshot**, never recomputed from current mutable data.

- **Phase 1 (snapshot)** — a full `rate_confirmations` row is `INSERT`ed
  **inside** `OffersService.accept()`'s existing award transaction. The
  commercial agreement is created by offer acceptance, not by carrier
  assignment; `assign()` never touches this table. Unique on `load_id`,
  `reference_number`, and `awarded_offer_round_id`.
- **Phase 2 (render)** — **after commit**, best-effort: render a PDF (no browser
  automation, no Chromium) and `putObject` it under the deterministic key
  `rate-confirmations/{load_id}/{rate_confirmation_id}.pdf`, then flip
  `status → GENERATED`. A render/storage failure never fails the award; a later
  retrieval retries generation lazily.
- **Retrieval** — `GET /api/loads/:id/rate-confirmation`, authorized by the load
  (`canReadLoad`: owning shipper, assigned/winning carrier, admin — everyone
  else 404, IDOR-safe). Returns `download` (a fresh short-lived URL) only when
  storage confirms the object exists; otherwise `documentPending: true`.
- **Immutability** — `loadtopia_protect_commercial_snapshot` compares every
  commercial column OLD vs NEW and rejects any change; only the three
  generation-metadata columns (`status`, `storage_key`, `generated_at`) may be
  updated. DELETE is unconditionally rejected.
- **Historical loads** — any load awarded before this feature shipped has no
  snapshot row; retrieval returns a stable `RATE_CONFIRMATION_NOT_AVAILABLE`.
  No snapshot is ever fabricated from current data.

---

## Private object storage

- `StorageProvider` interface: `createSignedUpload`, `createSignedDownload`,
  `headObject`, `putObject`.
- `MockStorageProvider` (default) is deliberately **non-functional** — its URLs
  resolve nowhere and it stores nothing. It is only for "storage doesn't matter
  right now" local dev.
- `FakeStorageProvider` (tests) is in-process and actually stores bytes, with
  `simulateUpload` / `simulateOutage` controls.
- `S3StorageProvider` is the real adapter: a private, non-public
  S3-compatible bucket (AWS S3, Cloudflare R2, MinIO, …). Uploads use a
  **presigned POST** (the only mechanism that enforces `content-length-range`
  and an exact `Content-Type` at the storage layer). Every consumer-facing
  access is a short-lived signed URL or a server-side write; persistent
  credentials live only in the API process.
- `STORAGE_PROVIDER=s3` with any required value missing **fails process
  startup** (`resolveS3StorageConfig` throws) — there is no fallback to
  `MockStorageProvider`.
- Production requires a real S3-compatible store. See
  [`ARCHITECTURE.md` §12](ARCHITECTURE.md) for the required env vars and the
  operator-side bucket CORS configuration the browser direct-upload needs.

---

## Immutability & audit (Milestone 3 additions)

| Table                | Guarantee                                                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `load_events`        | append-only DB trigger (M1); M3 events carry `actor_company_id`                                                                                           |
| `document_reviews`   | `loadtopia_reject_mutation` trigger — no UPDATE / DELETE; `document_id` UNIQUE                                                                            |
| `rate_confirmations` | commercial columns immutable by trigger; DELETE blocked                                                                                                   |
| `load_check_ins`     | append-only by API surface (no mutation endpoint or service path); no dedicated DB trigger — a known low-risk defense-in-depth gap vs. the sibling tables |
| `load_documents`     | intentionally mutable (`confirmed_at`, `review_status`, `removed_at`) — the mutations are the lifecycle                                                   |

`audit_logs` rows for `document.upload_request`, `document.confirm`,
`document.remove`, `document.approve`, `document.reject`, `load.pickup`,
`load.in_transit`, `load.deliver`, `load.complete`, `load.check_in`.

---

## Frontend

`apps/web` gains an operational experience inside the existing shell:

- **Shipper `/loads/[id]`** — shipment-progress stepper, check-in history,
  documents (list + upload + POD approve/reject + replacement), Rate
  Confirmation download, and a Complete action that appears only when the
  backend's actor-aware `availableTransitions` includes `COMPLETED`.
- **Carrier `/marketplace/[id]`** (off-market branch) — the same progress /
  check-ins / documents / Rate Confirmation, plus a `ShipmentActions` card
  (pickup → start transit → mark delivered) and the carrier check-in form.
- The browser performs the real two-stage upload directly against object
  storage; nothing is proxied through Next and no storage credential or object
  key is ever constructed client-side.
- Pure read-model + upload helpers are unit-tested (`apps/web` runs
  `vitest`); component/route correctness is covered by `tsc` + `next build`.
