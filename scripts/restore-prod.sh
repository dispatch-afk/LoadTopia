#!/usr/bin/env bash
# =============================================================================
# scripts/restore-prod.sh — restore a backup made by scripts/backup-prod.sh
# -----------------------------------------------------------------------------
# Two modes:
#   DRILL (default, non-destructive):  bash scripts/restore-prod.sh <backup-dir>
#       Restores pg.dump into a scratch database `loadtopia_restore_test`, prints
#       row counts for comparison with manifest.txt, extracts garage.tgz into a
#       temp dir and reports file counts. Production data is NOT touched.
#   PRODUCTION (destructive):          bash scripts/restore-prod.sh <backup-dir> --into-production
#       Stops api+web, restores pg.dump into `loadtopia` (--clean), replaces both
#       Garage volumes from garage.tgz, restarts everything. Requires typing YES.
# =============================================================================
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"; cd "$REPO"
ENVF="${ENVF:-.env.prod}"; DC="docker compose -f docker-compose.prod.yml --env-file $ENVF"
SRC="${1:?usage: restore-prod.sh <backup-dir> [--into-production]}"; MODE="${2:-drill}"
[ -f "$SRC/pg.dump" ] && [ -f "$SRC/garage.tgz" ] || { echo "backup dir incomplete: $SRC"; exit 1; }
log(){ echo "[$(date -u +%FT%TZ)] $*"; }
( cd "$SRC" && sha256sum -c SHA256SUMS ) || { log "ERROR: checksum mismatch"; exit 1; }

if [ "$MODE" != "--into-production" ]; then
  log "DRILL: restoring into scratch database loadtopia_restore_test"
  docker exec loadtopia-prod-postgres psql -U loadtopia -d postgres -Atc "drop database if exists loadtopia_restore_test; create database loadtopia_restore_test;"
  docker exec -i loadtopia-prod-postgres pg_restore -U loadtopia -d loadtopia_restore_test --no-owner < "$SRC/pg.dump"
  echo "--- row counts in restored scratch DB (compare with $SRC/manifest.txt):"
  docker exec loadtopia-prod-postgres psql -U loadtopia -d loadtopia_restore_test -Atc \
    "select 'companies='||count(*) from companies union all select 'users='||count(*) from users union all select 'loads='||count(*) from loads union all select 'load_documents='||count(*) from load_documents union all select 'audit_logs='||count(*) from audit_logs;"
  echo "--- applied migrations in restored DB: $(docker exec loadtopia-prod-postgres psql -U loadtopia -d loadtopia_restore_test -Atc 'select count(*) from _prisma_migrations where finished_at is not null')"
  docker exec loadtopia-prod-postgres psql -U loadtopia -d postgres -Atc "drop database loadtopia_restore_test;"
  TMP=$(mktemp -d); tar xzf "$SRC/garage.tgz" -C "$TMP"
  echo "--- garage archive: $(find "$TMP/data" -type f | wc -l) data files, $(find "$TMP/meta" -type f | wc -l) meta files, $(du -sh "$TMP" | cut -f1) total"
  rm -rf "$TMP"; log "DRILL OK — production untouched"
  exit 0
fi

echo "!!! PRODUCTION RESTORE from $SRC — this OVERWRITES the live database and document store."
read -r -p "Type YES to continue: " ans; [ "$ans" = "YES" ] || { echo "aborted"; exit 1; }
log "stopping api + web"; $DC stop api web
log "restoring postgres"; docker exec -i loadtopia-prod-postgres pg_restore -U loadtopia -d loadtopia --clean --if-exists --no-owner < "$SRC/pg.dump"
log "restoring garage volumes"; $DC stop garage
docker run --rm -v loadtopia_prod_garage_meta:/meta -v loadtopia_prod_garage_data:/data -v "$SRC":/bk:ro alpine \
  sh -c "rm -rf /meta/* /data/* && tar xzf /bk/garage.tgz -C /"
$DC start garage; sleep 5
log "starting api + web"; $DC start api web
log "PRODUCTION RESTORE complete — verify https://app.<domain> and run the smoke test"
