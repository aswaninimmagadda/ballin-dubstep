# Deployment

Environments: **local → staging → production**. Never develop against the
production database. Configuration is environment variables only
(`.env.example` is the contract). At deployment time, re-verify current
provider policies/limits — do not assume this document's free-tier notes
have stayed accurate.

## Backend (PostgreSQL)

Two equivalent options — the code is identical for both:

### Option A: Supabase (managed Postgres, free tier for the pilot)

1. Create a project (region: `ap-south-1` Mumbai for AP latency).
2. Apply migrations: `supabase db push` (the repo's `supabase/migrations`
   layout is CLI-compatible), or run the runner against the connection
   string: `DATABASE_URL=postgres://postgres:...@db.<ref>.supabase.co:5432/postgres pnpm db:migrate`.
3. Create the runtime password: `ALTER ROLE gymflow_app PASSWORD '<strong>'`.
4. Use the **direct/pooler connection string for `gymflow_app`** as
   `DATABASE_APP_URL`. The service-role key / owner URL is used only from
   your machine/CI for migrations — never in app config.
5. Free-tier notes (verify current): 500MB database, project pauses after
   ~1 week inactivity (unacceptable for production — schedule a keep-alive
   or upgrade), daily backups only on paid plans → run your own `pg_dump`
   (see DISASTER_RECOVERY.md).

### Option B: any managed Postgres (Neon/RDS/DO/self-hosted)

Same steps: migrate as owner, set `gymflow_app` password, point
`DATABASE_APP_URL` at it, enforce TLS (`?sslmode=require`).

## Admin web app (Next.js)

Any Node-capable host works. Vercel is the lowest-friction free-capable
option; a ₹400-500/mo VPS with `node .next/standalone` + Caddy is the
portable one.

Vercel: project root `apps/admin`, framework Next.js, install command
`pnpm install`, build `pnpm --filter @gymflow/admin build`. Environment
variables (Production + Preview): `DATABASE_APP_URL`, `SESSION_SECRET`
(32+ random bytes), `MEMBER_TOKEN_SECRET` (32+ random bytes, **rotating this
invalidates member QR passes + access tokens immediately** — sessions
survive). Custom domain + SSL are automatic. Rollback = redeploy previous
build from the dashboard.

Checklist per environment:

- [ ] Secrets set (never the DB owner URL)
- [ ] `pnpm db:migrate` run against the environment's DB from CI/operator
- [ ] Seed only on staging/demo — **never** the production seed
- [ ] Smoke: login, dashboard, member API login (see scripts/e2e-admin.mjs)
- [ ] Daily sweep scheduled (below)

### Scheduled jobs

Two cron entries on the operator box (or any scheduler that can reach the
DB with the **owner** URL — these are maintenance jobs, not app traffic):

```cron
# 01:00 IST daily — true up stored membership/member states
# (pending→active on start date, active→expired after grace; see
# KNOWN_LIMITATIONS.md #18 — reads stay correct even if a run is missed)
0 1 * * * cd /srv/gymflow && DATABASE_URL=$OWNER_DB_URL pnpm --filter @gymflow/database sweep

# 02:00 IST daily — off-provider backup (see DISASTER_RECOVERY.md)
0 2 * * * /srv/gymflow/ops/backup.sh
```

## Member app distribution

See `GOOGLE_PLAY_RELEASE.md` and `APPLE_APP_STORE_RELEASE.md` for stores.
To be explicit: there is **no member web/PWA build** in this cut — the
member experience is the Expo (React Native) Android app; iOS is prepared
but deferred (see the App Store doc). Only the _staff_ admin app is a PWA.

### Zero-store-cost pilot options

- **Staff:** the admin PWA installs from the browser (Add to Home Screen) —
  no store, auto-updating.
- **Members, Option A (recommended first):** don't ship the app yet; the
  gym operates admin-side while membership grows. WhatsApp links carry
  renewal comms.
- **Members, Option B:** direct APK (`eas build -p android --profile
preview`) shared privately. Trade-offs: no auto-updates (each fix needs a
  new APK install), users must enable unknown-source installs (a real
  security downgrade to normalize), no store integrity scanning. Acceptable
  for a closed pilot of a few dozen known members; **not** a scalable or
  recommended commercial channel.
- **Members, Option C:** Google Play internal → closed → production tracks
  when ready (₹? one-time $25 developer fee; verify current).

## CI/CD

`.github/workflows/ci.yml` gates every PR (format/lint/typecheck/unit/
integration incl. tenant isolation/builds). Production deploys are
intentionally manual for the pilot: promote from the host dashboard after CI
is green and migrations are applied. Do not wire auto-deploy until secrets
and migration ordering are owned by the pipeline.

## Cost picture (pilot)

Supabase free + Vercel Hobby + no SMS provider = ₹0/month recurring at
pilot load. First paid thresholds you will actually hit: Supabase 500MB /
project-pause policy, Vercel Hobby's non-commercial terms (move to Pro,
~$20/mo, when charging gyms). Set provider spend alerts on day one.
