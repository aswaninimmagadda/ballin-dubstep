# Disaster Recovery

The database _is_ the product state (files/photos are deferred, so today it
is the only stateful store). Apps are stateless and redeploy from git.

## Backups

**What:** nightly `pg_dump` of production + before every migration.

Use `ops/backup.sh` in this repository rather than a bare `pg_dump`: it
verifies the archive is readable before keeping it, refuses a suspiciously
small file, prunes only after the new dump is proven good, and warns when no
off-host copy is configured.

```bash
# nightly (cron on any trusted machine, or a scheduled CI job)
PROD_OWNER_URL="postgres://…"   \
BACKUP_DIR=/srv/backups         \
KEEP_DAILY=7                    \
OFFSITE_CMD="rclone copyto remote:gymflow-backups"  \
  ops/backup.sh
# Store copies off-provider (e.g. an encrypted object-storage bucket) — a
# provider outage must not take the backups with it. For weekly/monthly
# retention, point a second schedule at a different BACKUP_DIR/KEEP_DAILY.
```

On Supabase free tier there are **no usable managed backups** — the
self-run pg_dump above is mandatory, not optional. Paid tiers add PITR;
still keep the off-provider dumps.

## Restore procedure

**The roles come first.** Roles are cluster-level objects and `pg_dump` never
emits them, while the schema contains roughly seventy `GRANT … TO gymflow_app`
statements. Restore the dump alone into a fresh cluster and you get a database
with every row intact that the application cannot read a single row from:
every GRANT fails, and the app role does not exist. That is precisely the
scenario this runbook exists for. `ops/backup.sh` therefore writes a
`.roles.sql` file beside each dump; keep them together.

```bash
# 1. Roles (cluster-level; skip only if restoring beside an existing install)
psql "$ADMIN_URL" -f gymflow-YYYY-MM-DD-HHMM.roles.sql
# Passwords are deliberately NOT in the backup — set it from your secret store:
psql "$ADMIN_URL" -c "ALTER ROLE gymflow_app LOGIN PASSWORD '<from DATABASE_APP_URL>'"

# 2. The database
createdb gymflow_restore
pg_restore -d "$RESTORE_URL" --no-owner gymflow-YYYY-MM-DD-HHMM.dump

# 3. Prove the application can actually use it, before repointing anything
PROD_OWNER_URL="$ADMIN_URL" ops/restore-test.sh gymflow-YYYY-MM-DD-HHMM.dump
```

`ops/restore-test.sh` does the whole cycle into a scratch database and then
connects **as the application role, with tenant claims**, and reads real rows
through RLS — the assertion that actually matters. It refuses a dump with no
roles file beside it, and it never alters the `gymflow_app` password: roles are
cluster-wide, so a verification job that reset one would log the live
application out of production.

**Drill performed:** `ops/backup.sh` was run against the seeded database and
the resulting dump restored with `ops/restore-test.sh`, which reported the app
role reading the expected member count for the tenant through RLS. The same
script was then pointed at a dump with no roles file — the shape every backup
taken before this change has — and correctly refused it. Repeat the drill
quarterly against a production dump: a backup that has never been restored is
not a backup, and a restore that has never been used by the application is not
a restore.

## Scenario runbook

| Incident                              | Action                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bad deploy (app)                      | Roll back to the previous build on the host (Vercel: promote previous deployment). DB untouched.                                                                                                                                                                                         |
| Bad migration                         | Migrations run in transactions — a failed one leaves nothing applied. A _wrongly successful_ one: restore latest dump to a fresh DB, repoint, write a corrective migration. Never hand-edit production schema.                                                                           |
| Accidental data deletion by staff     | Financial rows can't be deleted at all. Members are archived, not deleted — unarchive. For true data loss: restore the dump to a scratch DB and copy the affected tenant's rows back (all rows carry tenant_id, so a tenant-scoped restore is a filtered `pg_restore -t`/INSERT-SELECT). |
| Credential leak (DB)                  | `ALTER ROLE gymflow_app PASSWORD` + rotate host env var; owner URL likewise. Sessions/API keep working (they don't embed DB creds).                                                                                                                                                      |
| Credential leak (MEMBER_TOKEN_SECRET) | Rotate the env var; member access tokens and QR passes are invalidated instantly and members re-authenticate via their refresh tokens. Staff sessions are DB rows — revoke them with `app.sessions_revoke_all`.                                                                          |
| Compromised staff account             | Deactivate the user (instant, RLS-checked) + `app.sessions_revoke_all(user)`. Audit log shows what they touched — it cannot have been erased.                                                                                                                                            |
| Provider outage                       | Apps degrade to errors, no corruption (transactional writes). Restore latest dump to any Postgres and repoint `DATABASE_APP_URL` — the stack has no other provider dependency.                                                                                                           |
| Tenant offboarding/restore            | Export their CSVs (built-in) + a filtered dump; tenant rows are self-contained by `tenant_id`.                                                                                                                                                                                           |

## Secrets inventory (where rotation happens)

`DATABASE_APP_URL` (host env),
`MEMBER_TOKEN_SECRET` (host env), DB owner URL (CI/operator only),
seed passwords (dev only). Nothing else exists yet; add gateway/SMS keys to
this list in Phase 2.
