# LoadTopia — Backup & Restore (self-hosted production)

_Required by the Local Development Handoff §11/§21 and by the M5 Build Spec ("Document
backup/restore before M5 introduces additional commercial records")._

## What must survive

| Data | Lives in | Backed up by |
|---|---|---|
| All business, commercial, audit and session records | Docker volume `loadtopia_prod_pgdata` (PostgreSQL 16) | `pg_dump -Fc` (consistent snapshot) |
| Operational documents (BOL/POD/other) and Rate Confirmation PDFs | Docker volumes `loadtopia_prod_garage_meta` + `loadtopia_prod_garage_data` (Garage) | tar of both volumes while Garage is paused |
| Configuration / secrets | `.env.prod` (mode 600, git-ignored) | **copy it to your password manager / offline store manually**; without it a restore cannot start the stack |
| Application code | git (`main` / release tags) | not part of backups |

Not needed: Caddy volumes (TLS state is re-fetched), images (rebuilt from git), the dev stack.

## Nightly backup

`scripts/backup-prod.sh` writes `/srv/loadtopia/backups/<UTC-stamp>/{pg.dump,garage.tgz,manifest.txt,SHA256SUMS}` and prunes directories older than 14 days. It exits non-zero on any failure.

One-time setup on the GX10 (as `craigw`, member of `docker` group):

```bash
sudo mkdir -p /srv/loadtopia/backups && sudo chown craigw:craigw /srv/loadtopia/backups
crontab -l 2>/dev/null | grep -v backup-prod.sh | { cat; echo "15 2 * * * cd /home/craigw/Projects/loadtopia && bash scripts/backup-prod.sh >> /srv/loadtopia/backups/backup.log 2>&1"; } | crontab -
crontab -l
```

**Off-host copy is not optional.** A backup on the same NVMe as the data protects
against mistakes, not against disk loss. Sync `/srv/loadtopia/backups` nightly
to somewhere else (an `rclone` job to object storage, or an `rsync` pull from the
Mac). Treat this as an open item until it is in place.

## Restore drill (monthly, non-destructive)

```bash
cd ~/Projects/loadtopia
bash scripts/restore-prod.sh /srv/loadtopia/backups/<stamp>
```

Verifies checksums, restores the dump into a scratch database `loadtopia_restore_test`,
prints row counts (compare with `manifest.txt`), confirms all migrations are present,
unpacks the Garage archive to a temp directory and counts files, then cleans up.
Production is untouched.

## Production restore (destructive)

Only after a confirmed loss. Stops the app, overwrites the database and the
document store from the chosen backup, restarts.

```bash
cd ~/Projects/loadtopia
bash scripts/restore-prod.sh /srv/loadtopia/backups/<stamp> --into-production   # asks you to type YES
```

Then log in and run the smoke test. Anything written between the backup time
and the loss is gone; the manifest's `stamp_utc` is the cut-off.

## Before every upgrade / migration

```bash
bash scripts/backup-prod.sh
```

Migrations are forward-only; rolling back a migration means restoring the
pre-upgrade backup with `--into-production`.

## Retention and size

14 daily backups locally. Postgres dumps are small at PoC scale; Garage archives
grow with uploaded documents. Check `du -sh /srv/loadtopia/backups` monthly.
