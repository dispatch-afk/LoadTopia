# Security notes

Foundational controls plus the marketplace (M2) and operations (M3) additions.
This is not a completed security program — it is the baseline the product is
built on. A penetration test is still required before public launch.

## In place — platform baseline

| Area                      | Control                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Password storage          | Argon2id (`@node-rs/argon2`), OWASP-baseline parameters from env                                                          |
| Session tokens            | 256-bit opaque, `httpOnly` + `SameSite=Lax` (+ `Secure` in prod) cookie; only SHA-256 hash stored; server-side revocation |
| User enumeration / timing | Uniform login error + hash verification on unknown email                                                                  |
| Transport headers         | `@fastify/helmet` on the API                                                                                              |
| CORS                      | Strict origin allowlist from `CORS_ORIGINS`; credentials mode                                                             |
| Input validation          | zod at every route boundary; unknown fields rejected (`.strict()`)                                                        |
| SQL injection             | Parameterized queries via Prisma only; health probe is a static string                                                    |
| Rate limiting             | Global (`@fastify/rate-limit`) + stricter limits on `/auth/*`, marketplace writes, and `POST /loads/:id/documents`        |
| Error leakage             | Central handler; 500s return a generic message + request id only                                                          |
| Audit logging             | Append-only `audit_logs`, extended per feature                                                                            |
| Secret management         | No secrets in repo; `.env` git-ignored; prod secrets via platform manager                                                 |
| Request correlation       | `x-request-id` per request, on every log line and response                                                                |
| Least-privilege data      | Authorization enforced server-side only; role on membership                                                               |

## Authorization model (M1–M3)

- **Permission catalogue** (`packages/domain/src/authz/`) — routes/services check
  permissions, never role strings. Object-level **resource policies** layer on
  top: `canReadLoad` (owning shipper + assigned carrier + admin),
  `canModifyLoad` (owning shipper only — never widened),
  `canOperateShipment` (assigned carrier company, `CARRIER_ASSIGNED`+),
  `canUploadOperationalDocument` (shipper **or** assigned carrier),
  `canManageOwnOperationalDocument` (company scope **and** the upload permission —
  membership alone is insufficient).
- **Cross-company / cross-scope access → 404**, never 403 (no existence oracle).
  Verified for loads, offers, check-ins, documents, and Rate Confirmation.
- **Active-company switching** — every operational read is fetched server-side
  per request with `cache: "no-store"`; permissions are re-resolved from the new
  active membership after a switch.
- **The web client's permission checks are cosmetic.** Hidden buttons are UX
  only; the API re-enforces every action.

## M3 — operations & document security

| Area              | Control                                                                                                                                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Carrier lifecycle | `/pickup` `/in-transit` `/deliver` gated by `canOperateShipment` + `SHIPMENT_OPERATE_ASSIGNED`; the owning shipper cannot move freight                                                                                                                     |
| Completion        | `/complete` shipper-only, additionally gated by an active **APPROVED** POD (`assertCompletionReadiness`, a pure DB check inside the txn)                                                                                                                   |
| Check-ins         | write = assigned carrier only; `recorded_at` server-authoritative (client cannot send it); append-only (no PATCH/DELETE endpoint); coordinates never derived                                                                                               |
| POD review        | `approve`/`reject` shipper-only (`load:update:own`); `document_reviews` immutable (trigger) + `document_id` UNIQUE → one terminal decision                                                                                                                 |
| Object keys       | always server-generated (`loads/{id}/documents/{id}`); `assertSafeObjectKey` rejects traversal/control chars; the browser never builds a key                                                                                                               |
| Upload integrity  | MIME allowlist (pdf/jpeg/png); 25 MiB (26,214,400 B) hard cap at the API **and** the presigned-POST policy; confirm requires stored `ContentLength` **exactly** equal to the declared size; `headObject` proves the object landed before the row is usable |
| Private objects   | bucket is non-public; every access is a short-lived (default 15 min) signed URL; the web client requests a fresh URL per click and never persists it; `DOCUMENT_OBJECT_MISSING` (409) instead of a dead link                                               |
| Retention         | a reviewed (APPROVED/REJECTED) POD can never be removed by anyone; removal is soft only; no row or object is ever physically deleted                                                                                                                       |
| Replacement POD   | reference valid only for a confirmed, non-removed, REJECTED POD on the **same** load — no cross-load reference                                                                                                                                             |
| Rate Confirmation | read scope = `canReadLoad` (IDOR-safe 404 for others); commercial snapshot immutable by trigger; historical loads get `RATE_CONFIRMATION_NOT_AVAILABLE`, never fabricated data                                                                             |
| Storage secrets   | S3 credentials live only in the API process — never read by `apps/web`, never in `/api/health` output, never logged; `STORAGE_PROVIDER=s3` with missing config fails boot (no mock fallback)                                                               |
| `/post` hardening | `POST /loads/:id/post` is DRAFT-only — cannot be used to re-post an `OFFER_RECEIVED`/`AWARDED` load and strand its award state                                                                                                                             |

## Immutability backstops

`load_events`, `offer_rounds`, `offer_events`, `pricing_snapshots`,
`document_reviews` — DB trigger rejects UPDATE/DELETE. `rate_confirmations` —
commercial columns immutable by trigger, DELETE blocked. Offer award — partial
unique index (`one ACCEPTED thread per load`). `document_reviews.document_id`
UNIQUE. `load_check_ins` is app-enforced append-only (no mutation path) but
lacks a dedicated trigger — a tracked low-risk defense-in-depth gap.

## Deferred (tracked on the roadmap)

- MFA/TOTP; SSO for enterprise; `api_keys` with scoped permissions.
- Per-endpoint rate-limit tuning and a distributed store (Redis).
- CSRF: mitigated by `SameSite=Lax` + JSON-only + CORS allowlist; add a
  double-submit token if browser form posts are introduced.
- Field-level encryption for sensitive PII; data-retention/erasure policy.
- A DB append-only trigger on `load_check_ins` (parity with sibling tables).
- Dependency scanning + SBOM in CI; secret scanning; container image scanning.
- Antivirus / content scanning of uploaded documents (today: metadata only —
  size + declared MIME; no byte inspection).
- Penetration test before public launch.

## Reporting

Until a formal process exists, email the repository owner.
