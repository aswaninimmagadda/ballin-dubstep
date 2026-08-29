#!/usr/bin/env bash
#
# Nightly GymFlow backup — the one DISASTER_RECOVERY.md and the DEPLOYMENT.md
# cron entry refer to. Takes a compressed pg_dump plus the cluster roles it
# depends on, prunes old copies, and fails loudly: a backup job that exits 0
# without producing a restorable dump is worse than no backup at all.
#
#   0 2 * * *  PROD_OWNER_URL=... BACKUP_DIR=/srv/backups /srv/gymflow/ops/backup.sh
#
# Required:  PROD_OWNER_URL   owner/superuser connection string (never the app role)
# Optional:  BACKUP_DIR       where dumps land (default /var/backups/gymflow)
#            KEEP_DAILY       daily dumps to retain (default 7)
#            OFFSITE_CMD      command plus its DESTINATION; the dump path is
#                             appended as the final argument, e.g.
#                               OFFSITE_CMD="rclone copyto remote:gymflow-backups"
#                               OFFSITE_CMD="aws s3 cp --only-show-errors"
#                             A dump that exists only on the database host is
#                             not a backup.
#
# WHY THE .roles.sql FILE EXISTS
# Roles are cluster-level objects and pg_dump never emits them. The schema
# contains ~70 GRANTs to gymflow_app, so restoring the dump alone into a fresh
# cluster produces a database with every row intact that the application cannot
# read a single row from — every GRANT fails and the app role does not exist.
# That is the exact scenario the runbook is for (provider gone, cluster lost),
# so the roles travel with the dump.
set -Eeuo pipefail

# Dumps contain every member's name, phone number and payment history, plus
# password hashes. They must not be world-readable.
umask 077

BACKUP_DIR="${BACKUP_DIR:-/var/backups/gymflow}"
KEEP_DAILY="${KEEP_DAILY:-7}"
STAMP="$(date -u +%F-%H%M)"
DUMP="${BACKUP_DIR}/gymflow-${STAMP}.dump"
ROLES="${BACKUP_DIR}/gymflow-${STAMP}.roles.sql"

fail() {
  echo "[gymflow-backup] FAILED: $*" >&2
  exit 1
}
trap 'fail "unexpected error on line $LINENO"' ERR

[ -n "${PROD_OWNER_URL:-}" ] || fail "PROD_OWNER_URL is not set"
command -v pg_dump >/dev/null || fail "pg_dump is not installed"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

echo "[gymflow-backup] dumping to ${DUMP}"
pg_dump "$PROD_OWNER_URL" --format=custom --no-owner --file="$DUMP"

# A dump that restores is the only kind that counts: list its table of
# contents, which parses the archive header and fails on a truncated file.
pg_restore --list "$DUMP" >/dev/null || fail "dump is unreadable — not keeping it"

SIZE="$(wc -c <"$DUMP")"
[ "$SIZE" -gt 10000 ] || fail "dump is suspiciously small (${SIZE} bytes)"

# Cluster roles. --no-role-passwords keeps password hashes out of the backup:
# the operator sets the app role's password from the secret store at restore
# time, and a stolen backup should not hand over a working login.
if command -v pg_dumpall >/dev/null; then
  echo "[gymflow-backup] dumping roles to ${ROLES}"
  pg_dumpall --dbname="$PROD_OWNER_URL" --roles-only --no-role-passwords >"$ROLES" \
    || fail "could not dump cluster roles"
  grep -q 'gymflow_app' "$ROLES" \
    || fail "roles dump does not mention gymflow_app — the restore would be unusable"
else
  # Managed providers (Supabase, RDS) often withhold pg_dumpall. Emit the one
  # role the schema actually grants to, so the restore path still works.
  echo "[gymflow-backup] pg_dumpall unavailable — writing a minimal role file"
  cat >"$ROLES" <<'SQL'
-- Minimal role file: the application role every GRANT in the schema targets.
-- Set its password from your secret store after restoring:
--   ALTER ROLE gymflow_app PASSWORD '<from DATABASE_APP_URL>';
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'gymflow_app') THEN
    CREATE ROLE gymflow_app LOGIN;
  END IF;
END $$;
SQL
fi

if [ -n "${OFFSITE_CMD:-}" ]; then
  echo "[gymflow-backup] copying off-host"
  # Word-split intentionally: OFFSITE_CMD is a command plus its arguments.
  # shellcheck disable=SC2086
  ${OFFSITE_CMD} "$DUMP" || fail "off-host copy failed"
  ${OFFSITE_CMD} "$ROLES" || fail "off-host copy of the roles file failed"
else
  echo "[gymflow-backup] WARNING: OFFSITE_CMD unset — this copy lives only on this host"
fi

# Prune only after the new dump is proven good.
find "$BACKUP_DIR" -name 'gymflow-*.dump' -type f -printf '%T@ %p\n' \
  | sort -rn | tail -n "+$((KEEP_DAILY + 1))" | cut -d' ' -f2- \
  | while read -r old; do
      echo "[gymflow-backup] pruning $(basename "$old")"
      rm -f "$old" "${old%.dump}.roles.sql"
    done

echo "[gymflow-backup] OK ${DUMP} (${SIZE} bytes) + ${ROLES}"
