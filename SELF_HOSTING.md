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
| Exposure | `localhost` | Cloudflare Tunnel only (outbound connector); nothing published on the host |
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
browser ──HTTPS──▶ Cloudflare edge (TLS, WAF, Access policy on app.*) ──tunnel──▶ cloudflared (container)
                                                                                     │ plain HTTP, internal network
                                                                                     ▼
                                                                                   Caddy :80  (routes by Host)
                                                                                     ├─ app.<domain>   → web:3000
                                                                                     ├─ api.<domain>   → api:4000
                                                                                     └─ files.<domain> → minio:9000
                              internal only: postgres:5432, minio:9001 (console, never published)
```

Nothing listens on any host interface: `cloudflared` dials **out** to Cloudflare
and Cloudflare forwards requests down the tunnel. The GX10's public IP is
never exposed and no router port is opened. TLS is Cloudflare's (Universal SSL
on your domain); Caddy serves plain HTTP to the tunnel only.

**Cloudflare Access** is applied to `app.<domain>` only. Users must pass a
browser-based identity check (one-time code by email to an allow-listed
address, or Google/Microsoft login) before they ever see the LoadTopia login
page — a second factor with nothing to install. `api.<domain>` and
`files.<domain>` carry **no** Access policy on purpose: the web container calls
`api.` server-side (an Access cookie would block it) and the browser uploads
to `files.` with presigned URLs. Both remain protected by the application's own
session auth / signed URLs, plus Cloudflare's WAF and rate limiting.

**Hairpin note.** `web → API_ORIGIN (api.<domain>)` and
`api → STORAGE_S3_ENDPOINT (files.<domain>)` resolve through public DNS and
travel out to Cloudflare and back down the tunnel. This is correct and simple,
costs a few tens of milliseconds per server-side call, and keeps the app's
"API_ORIGIN must be https://" rule satisfied with no code change. An internal
short-cut (Caddy internal CA + `NODE_EXTRA_CA_CERTS`) is a later optimisation.

## 4. One-time Cloudflare setup

1. **Domain on Cloudflare.** Add the site at dash.cloudflare.com (Free plan),
   change the nameservers at your registrar to the two Cloudflare gives you,
   wait for "Active". SSL/TLS mode: **Full** (Cloudflare ↔ tunnel is encrypted
   regardless).
2. **Tunnel.** Zero Trust dashboard → Networks → Tunnels → *Create a tunnel* →
   Cloudflared → name it `loadtopia-gx10`. On the *Install connector* step copy
   the **token** (the long string after `--token`) into `.env.prod` as
   `CF_TUNNEL_TOKEN`. Skip the install commands — the compose stack runs it.
3. **Public hostnames** (same tunnel → *Public Hostname* tab), three entries,
   all with **Service = HTTP, URL = `caddy:80`**:
   `app.<domain>`, `api.<domain>`, `files.<domain>`. Cloudflare creates the
   DNS records for you.
4. **Access policy.** Zero Trust → Access → Applications → *Add an application*
   → Self-hosted → domain `app.<domain>` → policy *Allow* with rule
   *Emails* = the people you invite (or *Emails ending in* `@yourcompany.com`).
   Authentication → *One-time PIN* is on by default; add Google/Microsoft
   under Settings → Authentication if you prefer. Session duration as you like.
5. **Optional hardening** (Security → WAF → Rate limiting rules): e.g. limit
   `api.<domain>/api/auth/*` to 10 requests/minute per IP; and a custom rule
   blocking `api.<domain>` unless `cf.connecting_ip` is the GX10's public IP
   (only the web container needs that host).

## 5. First deployment

```bash
cp .env.prod.example .env.prod          # fill LT_DOMAIN, CF_TUNNEL_TOKEN, secrets
chmod 600 .env.prod
DC="docker compose -f docker-compose.prod.yml --env-file .env.prod"
$DC pull && $DC build
$DC up -d postgres minio                 # DB + storage first
$DC --profile migrate run --rm migrate   # apply committed migrations (one-shot)
$DC up -d                                # api, web, caddy, cloudflared, minio-init (bucket)
$DC ps
```

Verify: `https://app.<domain>/login` shows the Cloudflare Access prompt first,
then (after the one-time code) the LoadTopia login page, with HSTS headers;
`https://api.<domain>/api/health/ready` returns 200; the tunnel shows
*Healthy* in the Zero Trust dashboard.

`GET /api/health` (not `/ready`) returns **503 while any provider is mock** —
that is by design; use `/api/health/ready` for monitoring.

No seed is run in production (`prisma/seed.ts` refuses `NODE_ENV=production`).
Create the first accounts through `/register` — reachable only by people your
Access policy allows.

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
  (the API refuses to boot otherwise); `CORS_ORIGINS` = exactly `https://app.<domain>`.
- No container publishes a port on the host. Postgres and MinIO are internal
  only; Caddy is reachable only from `cloudflared`; ingress is outbound-only.
- Cloudflare Access (email OTP / SSO allow-list) gates `app.<domain>` before
  the application login — a second factor with nothing to install.
- Caddy forwards `CF-Connecting-IP` as `X-Forwarded-For`, so the API's
  per-IP rate limits and audit-log IPs reflect real visitors. `trustProxy: true`
  is safe because Caddy/cloudflared is the only path in.
- Caddy adds HSTS, `nosniff`, `X-Frame-Options: DENY`, referrer and permissions
  policies for the web app (the app sets none itself) and caps request bodies
  (2 MB app/api, 30 MB storage — document uploads are ≤ 25 MiB).
- Cloudflare WAF, bot and DDoS protection apply to all three hostnames.
- Secrets live only in `.env.prod` (mode 600, git-ignored): DB and MinIO
  credentials are random per install; the tunnel token is a secret too.
  Dev credentials (`loadtopia_dev_pw`) are never reused.
- MinIO root credentials are used by the API for the PoC; before real
  production, create a scoped MinIO user/policy (`GetObject`, `PutObject`,
  `HeadObject` on the one bucket) and put those in `STORAGE_S3_*`.

Host-level (outside this repo): `ufw` default-deny inbound (SSH from LAN and
from your Tailscale admin network only), SSH key-only, `fail2ban`,
`unattended-upgrades`, Docker log rotation, off-host backups, and a read-only
deploy key instead of a personal GitHub token on the host.

## 10. Changing the edge later

The application never learns how it is exposed. To move from Cloudflare to a
direct public host (port-forward 443 → Caddy with Let's Encrypt), or to a LAN-only
setup, change only the `caddy`/`cloudflared` services and the three hostname
variables (`CORS_ORIGINS`, `API_ORIGIN`, `STORAGE_S3_ENDPOINT`). Nothing in
`apps/` or `packages/` changes.
