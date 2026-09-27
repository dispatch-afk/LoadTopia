# LoadTopia — Self-Hosting Guide

_Added with the self-hosting foundation (branch `chore/self-hosting`). Companion
docs: `ENVIRONMENT.md` (every variable), `README.md` (developer workflow),
`docs/ARCHITECTURE.md` (system design)._

This guide covers running the **released application** on a single Linux host
you control. It changes nothing about how the application works; it only
describes how to package, expose, persist, and back it up.

## 1. Two stacks, one host

| | Development (`docker-compose.yml`) | Production (`docker-compose.prod.yml`) |
|---|---|---|
| Compose project | `loadtopia` | `loadtopia-prod` |
| What runs in containers | PostgreSQL only | PostgreSQL, MinIO, API, web, Caddy |
| App processes | from source: `pnpm dev` (`:3000` / `:4000`) | built images (`apps/api/Dockerfile`, `apps/web/Dockerfile`) |
| Env file | `.env` | `.env.prod` |
| Volumes | `loadtopia_pgdata` | `loadtopia_prod_pgdata`, `loadtopia_prod_minio`, `loadtopia_prod_caddy_*` |
| Exposure | `localhost` | Tailscale IP only (`TS_IP`), TLS via Caddy |
| Providers | all `mock` | `mock` except `STORAGE_PROVIDER=s3` (MinIO) |

They never share a volume, a port, or an env file. `docker compose down -v` on
the dev project cannot touch production data.

## 2. Reference host

Verified on: ASUS Ascent GX10 (NVIDIA GB10, `aarch64`), Ubuntu 24.04.5 / DGX OS,
Docker Engine 29.6, Compose v5.2, Node 22 (nvm), pnpm 9.15.9 (corepack). Any
`linux/arm64` or `linux/amd64` Debian-compatible host with Docker works; the
API image uses `node:22-bookworm-slim` and Prisma's `linux-arm64-openssl-3.0.x`
/ `debian-openssl-3.0.x` engines. **Do not** switch the API image to Alpine on
arm64 (no musl-arm64 engine in `binaryTargets`).

## 3. Network topology (production)

```
tailnet device ──HTTPS──▶ Caddy (binds TS_IP only)
                            ├─ :443   → web:3000    (Next.js; proxies /api/* to API_ORIGIN at request time)
                            ├─ :8443  → api:4000    (Fastify; API_ORIGIN for the web container)
                            └─ :9443  → minio:9000  (S3 API; browser presigned POST/GET)
              internal only: postgres:5432, minio:9001 (console, not published)
```

All three origins share one hostname (`LT_HOST`, the machine's MagicDNS name)
and one Let's Encrypt certificate that `tailscaled` obtains and renews; Caddy
reads it through the mounted `tailscaled.sock` (`tls { get_certificate tailscale }`).
Inside the Docker network, `LT_HOST` is a network alias of the Caddy container,
so `web → API_ORIGIN` and `api → STORAGE_S3_ENDPOINT` resolve internally while
TLS SNI still matches the certificate.

Why the API is on `:8443` rather than a path: `apps/web/src/lib/api-origin.mjs`
requires `API_ORIGIN` to be a **bare `https://` origin** in production, and the
web app cannot point at itself (its own `/api/*` route handler is the proxy).

## 4. Prerequisites (one-time)

1. Tailscale installed and joined (`sudo tailscale up`). In the tailnet admin
   console (DNS page) enable **MagicDNS** and **HTTPS Certificates**.
   Verify: `sudo tailscale cert <machine>.<tailnet>.ts.net` succeeds.
2. Docker Engine + Compose v2, user in the `docker` group.
3. Repo cloned at the release you intend to run (`git describe --tags`).

## 5. First deployment

```bash
cp .env.prod.example .env.prod          # fill LT_HOST, TS_IP, secrets, register gate
chmod 600 .env.prod
DC="docker compose -f docker-compose.prod.yml --env-file .env.prod"
$DC build
$DC up -d postgres minio                 # DB + storage first
$DC --profile migrate run --rm migrate   # apply committed migrations (one-shot)
$DC up -d                                # api, web, caddy, minio-init (bucket)
$DC ps
```

Verify: `https://LT_HOST/login` returns 200 with HSTS headers;
`https://LT_HOST:8443/api/health/ready` returns 200; `https://LT_HOST/register`
returns 401 (basic-auth gate) until you remove that block from the Caddyfile.

`GET /api/health` (not `/ready`) returns **503 while any provider is mock** —
that is by design; use `/api/health/ready` for monitoring.

No seed is run in production (`prisma/seed.ts` refuses `NODE_ENV=production`).
Create the first accounts through `/register`.

## 6. Upgrades

```bash
git fetch && git checkout <new tag>
$DC build
$DC --profile migrate run --rm migrate   # ALWAYS before rolling the api
$DC up -d
```
Migrations are forward-only. Take a backup (§8) before every upgrade.
Rollback of code = check out the previous tag and rebuild; rollback of a
migration = restore the pre-upgrade dump.

## 7. Persistence

| Data | Volume | Notes |
|---|---|---|
| PostgreSQL | `loadtopia_prod_pgdata` | all business, audit, session data |
| Documents / Rate Confirmation PDFs | `loadtopia_prod_minio` | private bucket `STORAGE_S3_BUCKET` |
| TLS state | `loadtopia_prod_caddy_data` | disposable (re-fetched from tailscaled) |

`docker compose ... down` keeps volumes; `down -v` deletes them. Image rebuilds
never touch volumes. Test: `docker compose ... restart` → data intact.

## 8. Backup and restore (minimum viable)

```bash
# backup
mkdir -p /srv/loadtopia/backups && cd /srv/loadtopia/backups
docker exec loadtopia-prod-postgres pg_dump -U loadtopia -Fc loadtopia > pg_$(date +%F_%H%M).dump
docker run --rm -v loadtopia_prod_minio:/data:ro -v "$PWD":/bk alpine tar czf /bk/minio_$(date +%F_%H%M).tgz -C /data .
# restore (into a STOPPED api)
docker compose -f docker-compose.prod.yml --env-file .env.prod stop api web
docker exec -i loadtopia-prod-postgres pg_restore -U loadtopia -d loadtopia --clean --if-exists < pg_<stamp>.dump
docker run --rm -v loadtopia_prod_minio:/data -v "$PWD":/bk alpine sh -c "cd /data && tar xzf /bk/minio_<stamp>.tgz"
docker compose -f docker-compose.prod.yml --env-file .env.prod start api web
```
Schedule the backup with cron and copy dumps **off the host**. Do a restore
drill into a scratch database before relying on it. (A full `BACKUP_RESTORE.md`
with scripts is the next documentation deliverable.)

## 9. Security posture (what this stack enforces)

- API and web run with `NODE_ENV=production`; `SESSION_COOKIE_SECURE=true`
  (the API refuses to boot otherwise); `CORS_ORIGINS` = exactly the web origin.
- Postgres and MinIO are never published to a host interface.
- Caddy binds only to the Tailscale IP; the LAN and the internet see nothing.
  `trustProxy: true` in the API is therefore safe (Caddy is the only path in).
- Caddy adds HSTS, `nosniff`, `X-Frame-Options: DENY`, referrer and
  permissions policies for the web app (the app sets none itself) and caps
  request bodies (2 MB app, 30 MB storage — document uploads are ≤ 25 MiB).
- `/register` and `POST /api/auth/register` sit behind HTTP basic auth until
  the owner opens signups (delete the `@register` block in the Caddyfile).
- Secrets live only in `.env.prod` (mode 600, git-ignored). Dev credentials
  (`loadtopia_dev_pw`) are never reused.
- MinIO root credentials are used by the API for the PoC; before real
  production, create a scoped MinIO user/policy (`GetObject`, `PutObject`,
  `HeadObject` on the one bucket) and put those in `STORAGE_S3_*`.

Host-level recommendations (outside this repo): `ufw` default-deny with SSH
from the LAN only and all traffic on `tailscale0`; SSH key-only; `fail2ban`;
`unattended-upgrades`; Docker log rotation; off-host backups; rotate any
personal GitHub token on the host for a read-only deploy key.

## 10. Going beyond the tailnet

To publish on your own domain later, keep this stack and change only the edge:
either a Cloudflare Tunnel (no inbound ports; optional Cloudflare Access login
gate) pointing at Caddy, or port-forward 443 to Caddy with a Let's Encrypt
`tls` block for the public hostname. `LT_HOST`, `CORS_ORIGINS`, `API_ORIGIN`
and `STORAGE_S3_ENDPOINT` then move to the public hostname. Nothing in the
application changes.
