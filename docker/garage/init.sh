#!/usr/bin/env bash
# =============================================================================
# docker/garage/init.sh — one-time (idempotent) Garage setup for LoadTopia prod
# -----------------------------------------------------------------------------
# Run from the repo root AFTER `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d garage`:
#     bash docker/garage/init.sh
# Reads from .env.prod: STORAGE_S3_BUCKET, STORAGE_S3_ACCESS_KEY_ID, STORAGE_S3_SECRET_ACCESS_KEY, LT_DOMAIN
# Does: assign single-node layout (once) -> import the app's access key (once) ->
#       create bucket (once) -> grant read/write/owner -> set bucket CORS for the web origin.
# Safe to re-run: every step checks before acting.
# =============================================================================
set -o pipefail
ENVF="${ENVF:-.env.prod}"; C="loadtopia-prod-garage"
getv(){ grep -E "^$1=" "$ENVF" | head -1 | cut -d= -f2-; }
BUCKET=$(getv STORAGE_S3_BUCKET); [ -n "$BUCKET" ] || BUCKET=loadtopia-prod
AK=$(getv STORAGE_S3_ACCESS_KEY_ID); SK=$(getv STORAGE_S3_SECRET_ACCESS_KEY); DOMAIN=$(getv LT_DOMAIN)
[ -n "$AK" ] && [ -n "$SK" ] && [ -n "$DOMAIN" ] || { echo "missing STORAGE_S3_* / LT_DOMAIN in $ENVF"; exit 1; }
g(){ docker exec "$C" /garage -c /etc/garage.toml "$@"; }   # scratch image: binary is /garage, no PATH
ok(){ echo "   [OK]   $1"; }; fail(){ echo "   [FAIL] $1"; exit 1; }

# wait for the node
for i in $(seq 1 30); do g status >/dev/null 2>&1 && break; sleep 2; [ "$i" = 30 ] && fail "garage not responding"; done

# 1. layout (single node, 1 zone). Capacity is a weight, not a quota; 100G is fine on a 900G disk.
#    Idempotency: `garage status` prints "NO ROLE ASSIGNED" for a node that has no layout role yet.
if g status 2>/dev/null | grep -q "NO ROLE ASSIGNED"; then
  NODE=$(g status 2>/dev/null | grep -oE '\b[0-9a-f]{16}\b' | head -1)
  [ -n "$NODE" ] || { g status; fail "could not find node id"; }
  g layout assign -z dc1 -c 100G "$NODE" || fail "layout assign"
  # next version = current version + 1 (0 when fresh)
  CUR=$(g layout show 2>/dev/null | grep -oiE 'layout version:? *[0-9]+' | grep -oE '[0-9]+$' | head -1); CUR=${CUR:-0}
  g layout apply --version $((CUR+1)) || fail "layout apply"
  ok "layout assigned to node $NODE (version $((CUR+1)))"
else
  ok "layout already assigned"
  # discard any staged-but-uncommitted role changes left by an earlier run
  if g layout show 2>/dev/null | grep -qi "staged"; then g layout revert --yes 2>/dev/null || g layout revert 2>/dev/null || true; fi
fi

# 2. access key (imported so the API's env vars and Garage agree)
if g key info loadtopia-app >/dev/null 2>&1; then ok "key loadtopia-app exists"
else
  g key import --yes -n loadtopia-app "$AK" "$SK" 2>/dev/null \
  || g key import -n loadtopia-app "$AK" "$SK" --yes 2>/dev/null \
  || { echo "--- key import help:"; g key import --help; fail "key import"; }
  ok "imported key loadtopia-app ($AK)"
fi

# 3. bucket + permissions
if g bucket info "$BUCKET" >/dev/null 2>&1; then ok "bucket $BUCKET exists"; else g bucket create "$BUCKET" || fail "bucket create"; ok "created bucket $BUCKET"; fi
g bucket allow --read --write --owner "$BUCKET" --key loadtopia-app >/dev/null || fail "bucket allow"
ok "key has read/write/owner on $BUCKET"

# 4. bucket CORS: browser does presigned POST (upload) and GET (download) from https://app.<domain>
CORS=$(cat <<JSON
{"CORSRules":[{"AllowedOrigins":["https://app.$DOMAIN"],"AllowedMethods":["GET","POST","PUT","HEAD"],"AllowedHeaders":["*"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3000}]}
JSON
)
NET=$(docker inspect "$C" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
docker run --rm --network "$NET" -e AWS_ACCESS_KEY_ID="$AK" -e AWS_SECRET_ACCESS_KEY="$SK" -e AWS_DEFAULT_REGION=garage \
  amazon/aws-cli:latest --endpoint-url http://garage:3900 s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration "$CORS" \
  || fail "put-bucket-cors"
ok "CORS set for https://app.$DOMAIN"
docker run --rm --network "$NET" -e AWS_ACCESS_KEY_ID="$AK" -e AWS_SECRET_ACCESS_KEY="$SK" -e AWS_DEFAULT_REGION=garage \
  amazon/aws-cli:latest --endpoint-url http://garage:3900 s3api get-bucket-cors --bucket "$BUCKET" | head -20
echo "garage init done"
