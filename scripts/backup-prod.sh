#!/usr/bin/env bash
# =============================================================================
# scripts/backup-prod.sh — nightly backup of the self-hosted PRODUCTION stack
# -----------------------------------------------------------------------------
# What is backed up
#   1. PostgreSQL: pg_dump custom format (-Fc), transactionally consistent.
#   2. Garage object storage: tar of BOTH volumes (meta + data) taken while the
#      garage container is paused (~seconds) so metadata and blobs are consistent.
# Output: $BACKUP_DIR/<UTC stamp>/{pg.dump,garage.tgz,manifest.txt}  (+ sha256 sums)
# Retention: directories older than $RETENTION_DAYS are deleted.
# Usage:  bash scripts/backup-prod.sh            (from the repo root; needs docker group)
# Cron:   see BACKUP_RESTORE.md (nightly 02:15 local). Copy backups OFF the host.
# Exit code non-zero on any failure (so cron mail / monitoring can catch it).
# =============================================================================
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"; cd "$REPO"
ENVF="${ENVF:-.env.prod}"; BACKUP_DIR="${BACKUP_DIR:-/srv/loadtopia/backups}"; RETENTION_DAYS="${RETENTION_DAYS:-14}"
DC="docker compose -f docker-compose.prod.yml --env-file $ENVF"
STAMP=$(date -u +%Y%m%dT%H%M%SZ); OUT="$BACKUP_DIR/$STAMP"
mkdir -p "$OUT"
log(){ echo "[$(date -u +%FT%TZ)] $*"; }

log "postgres dump -> $OUT/pg.dump"
docker exec loadtopia-prod-postgres pg_dump -U loadtopia -Fc loadtopia > "$OUT/pg.dump"
[ -s "$OUT/pg.dump" ] || { log "ERROR: empty pg.dump"; exit 1; }

log "garage snapshot (pausing garage for consistency)"
$DC pause garage >/dev/null
trap '$DC unpause garage >/dev/null 2>&1 || true' EXIT
docker run --rm -v loadtopia_prod_garage_meta:/meta:ro -v loadtopia_prod_garage_data:/data:ro -v "$OUT":/bk alpine \
  tar czf /bk/garage.tgz -C / meta data
$DC unpause garage >/dev/null; trap - EXIT
[ -s "$OUT/garage.tgz" ] || { log "ERROR: empty garage.tgz"; exit 1; }

( cd "$OUT" && sha256sum pg.dump garage.tgz > SHA256SUMS )
{
  echo "stamp_utc=$STAMP"; echo "host=$(hostname)"; echo "repo_head=$(git rev-parse HEAD)"; echo "branch=$(git branch --show-current)"
  echo "pg_dump_bytes=$(stat -c%s "$OUT/pg.dump")"; echo "garage_tgz_bytes=$(stat -c%s "$OUT/garage.tgz")"
  echo "pg_row_counts:"; docker exec loadtopia-prod-postgres psql -U loadtopia -d loadtopia -Atc \
    "select 'companies='||count(*) from companies union all select 'users='||count(*) from users union all select 'loads='||count(*) from loads union all select 'load_documents='||count(*) from load_documents union all select 'audit_logs='||count(*) from audit_logs;"
} > "$OUT/manifest.txt"
log "manifest:"; cat "$OUT/manifest.txt"

log "retention: removing backups older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$RETENTION_DAYS" -print -exec rm -rf {} +
log "done: $OUT"
