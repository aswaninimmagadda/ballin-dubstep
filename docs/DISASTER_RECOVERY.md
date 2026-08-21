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

## Restore procedure (tested)

```bash
createdb gymflow_restore
pg_restore -d "$RESTORE_URL" --no-owner --role=gymflow gymflow-YYYY-MM-DD.dump
# verify: row counts on tenants/members/payments; run the integration
# suite's read checks; then repoint DATABASE_APP_URL (ALTER ROLE gymflow_app
# PASSWORD on the new instance first).
```

**Restore test performed during development:** a full `pg_dump -Fc` of the
seeded dev database (1 tenant, 35 members, 40 memberships, 39 payments +
receipts, 42 attendance rows) was restored into a fresh database; all row
counts matched, and RLS remained enforced on the restored database (the
runtime role with no claims sees zero rows). The integration suite
additionally rebuilds the schema from migrations on every run. Repeat this
drill quarterly against a production dump — a backup that has never been
restored is not a backup.

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
