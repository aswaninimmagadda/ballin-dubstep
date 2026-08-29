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
variables (Production + Preview): `DATABASE_APP_URL` and
`MEMBER_TOKEN_SECRET` (32+ random bytes, **rotating this
invalidates member QR passes + access tokens immediately** — sessions
survive). Custom domain + SSL are automatic. Rollback = redeploy previous
build from the dashboard.

### `TRUSTED_PROXY_HOPS` — required behind any reverse proxy

Login throttling counts failures per address. The address can only come from
`X-Forwarded-For`, and that header is only trustworthy from the right: every
standard proxy (Caddy's `reverse_proxy`, nginx's `proxy_add_x_forwarded_for`)
**appends** what it observed, so the left-most entry is whatever the client
typed. `TRUSTED_PROXY_HOPS` says how many proxies sit in front of the app, and
the caller's address is read that many entries from the end.

| Deployment                                  | Value             |
| ------------------------------------------- | ----------------- |
| Caddy or nginx directly in front of the app | `1`               |
| Cloudflare (or another CDN) → Caddy → app   | `2`               |
| Vercel                                      | `1`               |
| App exposed directly, no proxy              | leave unset (`0`) |

**Unset means per-address throttling is off**, by design: a limiter fed a
value the caller controls is not just bypassable, it is aimable — 60 forged
failures against a gym's public address would lock that gym out of both apps
for 15 minutes. Per-identifier throttling (8 failures per account) is
unaffected and is the control that actually stops password guessing.

Setting the number too high is safe (the app attributes nothing rather than
guess); setting it too low re-opens the bypass. Count the proxies that append
to the header, not the total number of hops.

Checklist per environment:

- [ ] Secrets set (never the DB owner URL)
- [ ] `TRUSTED_PROXY_HOPS` matches the proxy chain in front of the app
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

# 02:00 IST daily — verified pg_dump + prune (ops/backup.sh in this repo).
# It refuses to keep a dump it cannot read back, and warns when OFFSITE_CMD
# is unset — set it, or the only copy lives on the database host.
0 2 * * * PROD_OWNER_URL=$OWNER_DB_URL BACKUP_DIR=/srv/backups OFFSITE_CMD="rclone copyto remote:gymflow-backups" /srv/gymflow/ops/backup.sh
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
