#!/usr/bin/env bash
#
# Prove a backup restores into a database the APPLICATION can use.
#
# The distinction matters, and it is the one that failed: a dump can restore
# perfectly and still leave a system nobody can log into. Roles are
# cluster-level and pg_dump never emits them, so restoring into a fresh
# cluster left ~70 GRANTs to gymflow_app failing and the app role missing —
# every row present, and not one readable by the app. The old check only ran
# `pg_restore --list`, which parses the archive header and proves nothing
# about that.
#
# This restores into a scratch database, then connects AS THE APP ROLE with
# tenant claims and reads a real row through RLS. That is the assertion the
# runbook actually depends on.
#
#   PROD_OWNER_URL=postgres://postgres@host/postgres \
#   ops/restore-test.sh /var/backups/gymflow/gymflow-2026-08-28-0200.dump
#
# Required:  PROD_OWNER_URL   owner/superuser URL, used to create the scratch DB
# Optional:  RESTORE_DB       scratch database name (default gymflow_restore_test)
#            KEEP             set to 1 to leave the scratch database behind
#
# This never changes the gymflow_app role's password. Roles are cluster-wide,
# so setting one here would log the LIVE application out of the production
# database — a verification job must not be able to cause the outage it is
# checking for. It uses SET ROLE from the owner connection instead, which
# gives the same effective privileges and the same RLS behaviour.
set -Eeuo pipefail

DUMP="${1:-}"
RESTORE_DB="${RESTORE_DB:-gymflow_restore_test}"

fail() { echo "[restore-test] FAILED: $*" >&2; exit 1; }
trap 'fail "unexpected error on line $LINENO"' ERR

[ -n "$DUMP" ] || fail "usage: PROD_OWNER_URL=… ops/restore-test.sh <dump file>"
[ -f "$DUMP" ] || fail "no such dump: $DUMP"
[ -n "${PROD_OWNER_URL:-}" ] || fail "PROD_OWNER_URL is not set"

ROLES="${DUMP%.dump}.roles.sql"
[ -f "$ROLES" ] || fail "no roles file beside the dump ($ROLES) — restoring this
  backup would produce a database the application cannot read. Take a new
  backup with the current ops/backup.sh."

BASE="${PROD_OWNER_URL%/*}"
ADMIN_URL="${BASE}/postgres"
TARGET_URL="${BASE}/${RESTORE_DB}"

cleanup() {
  if [ "${KEEP:-0}" != "1" ]; then
    psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS ${RESTORE_DB} WITH (FORCE)" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "[restore-test] creating scratch database ${RESTORE_DB}"
psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS ${RESTORE_DB} WITH (FORCE)"
psql "$ADMIN_URL" -q -c "CREATE DATABASE ${RESTORE_DB}"

echo "[restore-test] applying cluster roles"
# Not ON_ERROR_STOP: a real cluster may already have some of these roles (that
# is the normal case when restoring beside an existing install), and
# "role already exists" is not a failure. What matters is the assertion below.
psql "$ADMIN_URL" -q -f "$ROLES" >/tmp/restore-roles.log 2>&1 || true
psql "$ADMIN_URL" -tAc "SELECT 1 FROM pg_roles WHERE rolname='gymflow_app'" | grep -q 1 \
  || fail "gymflow_app does not exist after applying the roles file — the restored
  database would have every row and no way for the application to read them"

echo "[restore-test] restoring the dump"
pg_restore --dbname="$TARGET_URL" --no-owner "$DUMP" >/dev/null 2>/tmp/restore-test.err || {
  grep -q 'error' /tmp/restore-test.err && fail "pg_restore reported errors: $(head -3 /tmp/restore-test.err)"
}
if grep -qi 'role .* does not exist' /tmp/restore-test.err; then
  fail "GRANTs failed because a role is missing — this is the defect the roles file exists to prevent"
fi

echo "[restore-test] reading as the application role, through RLS"

TENANT="$(psql "$TARGET_URL" -tAc "SELECT id FROM tenants ORDER BY created_at LIMIT 1")"
[ -n "$TENANT" ] || fail "restored database has no tenants"
STAFF="$(psql "$TARGET_URL" -tAc "SELECT id FROM users WHERE kind='staff' AND tenant_id='${TENANT}' AND is_active LIMIT 1")"
[ -n "$STAFF" ] || fail "restored database has no active staff user for tenant ${TENANT}"

# SET LOCAL ROLE, not a separate login: the owner connection drops to the app
# role for the duration of one transaction, so the GRANTs and the RLS policies
# apply exactly as they do for a real request, and no cluster-wide role is
# modified. Everything is rolled back.
VISIBLE="$(psql "$TARGET_URL" -tAX -v ON_ERROR_STOP=1 <<SQL | grep -E '^[0-9]+$' | tail -1
BEGIN;
SET LOCAL ROLE gymflow_app;
SELECT set_config('request.jwt.claims', '{"sub":"${STAFF}","tenant_id":"${TENANT}","kind":"staff"}', true) \\g /dev/null
SELECT count(*) FROM members;
ROLLBACK;
SQL
)"
[ -n "$VISIBLE" ] || fail "the application role could not query the restored database"

EXPECTED="$(psql "$TARGET_URL" -tAc "SELECT count(*) FROM members WHERE tenant_id='${TENANT}'")"
[ "$VISIBLE" = "$EXPECTED" ] \
  || fail "the app role sees ${VISIBLE} members but the tenant has ${EXPECTED} — GRANTs or RLS did not survive the restore"

echo "[restore-test] OK — restored, and the app role reads ${VISIBLE} members for tenant ${TENANT}"
