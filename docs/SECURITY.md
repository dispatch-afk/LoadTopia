# Security notes (Phase 0)

Foundational controls in place. This is not a completed security program — it is
the baseline the product is built on.

## In place

| Area                     | Control                                                                 |
| ------------------------ | -------------------------------------------------------------------- |
| Password storage         | Argon2id (`@node-rs/argon2`), OWASP-baseline parameters from env      |
| Session tokens           | 256-bit opaque, `httpOnly` + `SameSite=Lax` (+ `Secure` in prod) cookie; only SHA-256 hash stored; server-side revocation |
| User enumeration / timing| Uniform login error + hash verification on unknown email             |
| Transport headers        | `@fastify/helmet` on the API                                          |
| CORS                     | Strict origin allowlist from `CORS_ORIGINS`; credentials mode         |
| Input validation         | zod at every route boundary; unknown fields rejected (`.strict()`)    |
| SQL injection            | Parameterized queries via Prisma only; health probe is a static string |
| Rate limiting            | Global (`@fastify/rate-limit`) + stricter limit on `/auth/*`          |
| Error leakage            | Central handler; 500s return a generic message + request id only      |
| Audit logging            | Append-only `audit_logs` for auth events (extended per feature)       |
| Secret management        | No secrets in repo; `.env` git-ignored; prod secrets via platform manager |
| Request correlation      | `x-request-id` per request, on every log line and response           |
| Least-privilege data     | Authorization enforced server-side only; role on membership          |

## Deferred (tracked on the roadmap)

- MFA/TOTP; SSO for enterprise; `api_keys` with scoped permissions.
- Fine-grained per-endpoint rate-limit tuning and a distributed store (Redis).
- CSRF: currently mitigated by `SameSite=Lax` + JSON-only + CORS allowlist; add
  a double-submit token when non-idempotent form posts from browsers are introduced.
- Field-level encryption for sensitive PII; data-retention/erasure policy.
- Dependency scanning + SBOM in CI; secret scanning; container image scanning.
- Penetration test before public launch.

## Reporting

Until a formal process exists, email the repository owner.
