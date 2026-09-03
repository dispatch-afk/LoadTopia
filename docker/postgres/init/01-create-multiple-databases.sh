#!/bin/bash
# Creates additional databases listed in POSTGRES_MULTIPLE_DATABASES
# (comma-separated). Runs once, on first container init.
set -euo pipefail

if [ -n "${POSTGRES_MULTIPLE_DATABASES:-}" ]; then
  for db in $(echo "$POSTGRES_MULTIPLE_DATABASES" | tr ',' ' '); do
    echo "Creating additional database '$db'"
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
      SELECT 'CREATE DATABASE "$db"'
      WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$db')\gexec
      GRANT ALL PRIVILEGES ON DATABASE "$db" TO "$POSTGRES_USER";
EOSQL
  done
fi
