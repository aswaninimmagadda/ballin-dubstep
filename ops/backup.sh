#!/usr/bin/env bash
#
# Nightly GymFlow backup — the one DISASTER_RECOVERY.md and the DEPLOYMENT.md
# cron entry refer to. Takes a compressed pg_dump, prunes old copies, and
# fails loudly: a backup job that exits 0 without producing a dump is worse
# than no backup at all.
#
#   0 2 * * *  PROD_OWNER_URL=... BACKUP_DIR=/srv/backups /srv/gymflow/ops/backup.sh
#
# Required:  PROD_OWNER_URL   owner/superuser connection string (never the app role)
# Optional:  BACKUP_DIR       where dumps land (default /var/backups/gymflow)
#            KEEP_DAILY       daily dumps to retain (default 7)
#            OFFSITE_CMD      command run with the dump path appended, e.g.
#                             "aws s3 cp" or "rclone copyto" — a dump that only
#                             exists on the database host is not a backup.
set -Eeuo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/gymflow}"
KEEP_DAILY="${KEEP_DAILY:-7}"
STAMP="$(date -u +%F-%H%M)"
DUMP="${BACKUP_DIR}/gymflow-${STAMP}.dump"

fail() {
  echo "[gymflow-backup] FAILED: $*" >&2
  exit 1
}
trap 'fail "unexpected error on line $LINENO"' ERR

[ -n "${PROD_OWNER_URL:-}" ] || fail "PROD_OWNER_URL is not set"
command -v pg_dump >/dev/null || fail "pg_dump is not installed"
mkdir -p "$BACKUP_DIR"

echo "[gymflow-backup] dumping to ${DUMP}"
pg_dump "$PROD_OWNER_URL" --format=custom --no-owner --file="$DUMP"

# A dump that restores is the only kind that counts: list its table of
# contents, which parses the archive header and fails on a truncated file.
pg_restore --list "$DUMP" >/dev/null || fail "dump is unreadable — not keeping it"

SIZE="$(wc -c <"$DUMP")"
[ "$SIZE" -gt 10000 ] || fail "dump is suspiciously small (${SIZE} bytes)"

if [ -n "${OFFSITE_CMD:-}" ]; then
  echo "[gymflow-backup] copying off-host"
  # Word-split intentionally: OFFSITE_CMD is a command plus its arguments.
  # shellcheck disable=SC2086
  ${OFFSITE_CMD} "$DUMP" || fail "off-host copy failed"
else
  echo "[gymflow-backup] WARNING: OFFSITE_CMD unset — this copy lives only on this host"
fi

# Prune only after the new dump is proven good.
find "$BACKUP_DIR" -name 'gymflow-*.dump' -type f -printf '%T@ %p\n' \
  | sort -rn | tail -n "+$((KEEP_DAILY + 1))" | cut -d' ' -f2- \
  | while read -r old; do
      echo "[gymflow-backup] pruning $(basename "$old")"
      rm -f "$old"
    done

echo "[gymflow-backup] OK ${DUMP} (${SIZE} bytes)"
