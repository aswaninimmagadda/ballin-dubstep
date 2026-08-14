# GymFlow — Multi-Tenant Gym Management Platform

GymFlow (working name — see `packages/config`) is a production-oriented gym
management SaaS built for small Indian gyms first (Andhra Pradesh pilot,
English + Telugu) and multi-gym commercialization second. It replaces
notebooks, paper receipts and WhatsApp tracking with:

- **Staff/Admin web app (PWA)** — dashboard, member onboarding, membership
  sales/renewals/freezes, payments + receipts, attendance, leads, promotions,
  reports, audit log. `apps/admin`, Next.js.
- **Member mobile app** — membership status, rotating QR gym pass, receipts,
  attendance, PT, offers. `apps/member`, Expo/React Native (Android + iOS).
- **One PostgreSQL backend** — multi-tenant from the first migration, with
  Row-Level Security as the enforcement layer, append-only financial records
  and a sealed authentication data path. `supabase/migrations`.

## Repository layout

```
apps/
  admin/        Next.js staff app + member REST API (single backend)
  member/       Expo member app
packages/
  types/        Shared TypeScript domain model
  core/         Business rules: dates, pricing, renewals, RBAC, QR pass, passwords
  utils/        Money (integer paise), calendar dates, Indian phone numbers
  validation/   zod schemas for every write path
  i18n/         English + Telugu resources (completeness-tested)
  config/       Product identity, platform defaults, design tokens
  database/     Migration runner, claims-scoped client, seed, integration tests
supabase/
  migrations/   Plain SQL migrations (Supabase-CLI-compatible layout)
scripts/
  e2e-admin.mjs HTTP end-to-end test of the critical business flows
docs/           Full documentation set (see docs/PRODUCT_OVERVIEW.md)
```

## Quick start (local)

Prerequisites: Node ≥ 20, pnpm ≥ 9, PostgreSQL 16.

```bash
pnpm install

# 1. Create databases + roles (once)
sudo -u postgres psql \
  -c "CREATE ROLE gymflow LOGIN PASSWORD 'gymflow_dev_pw' SUPERUSER" \
  -c "CREATE DATABASE gymflow_dev OWNER gymflow" \
  -c "CREATE DATABASE gymflow_test OWNER gymflow"
# The runtime role is created by migration 0001; give it a dev password:
#   ALTER ROLE gymflow_app PASSWORD 'gymflow_app_dev_pw';

# 2. Migrate + seed the demo gym (30 fictional members, 2 branches)
DATABASE_URL=postgres://gymflow:gymflow_dev_pw@localhost:5432/gymflow_dev pnpm db:migrate
DATABASE_URL=postgres://gymflow:gymflow_dev_pw@localhost:5432/gymflow_dev pnpm db:seed
sudo -u postgres psql -c "ALTER ROLE gymflow_app PASSWORD 'gymflow_app_dev_pw'"

# 3. Admin app
cp .env.example apps/admin/.env.local   # fill SESSION_SECRET etc.
pnpm dev:admin                          # http://localhost:3000

# 4. Member app (Expo)
pnpm dev:member
```

Demo logins (local seed only — passwords come from `SEED_PASSWORD` /
`SEED_MEMBER_PASSWORD`, with dev-only defaults printed by the seed):
`owner@demo.gymflow.local`, `manager@demo.gymflow.local`,
`reception@demo.gymflow.local`, `accounts@demo.gymflow.local`,
platform `admin@gymflow.local`; member app gym code `apfitness` with any of
the first three seeded mobiles.

## Quality gates

```bash
pnpm format:check   # prettier
pnpm lint           # eslint (zero errors)
pnpm typecheck      # tsc across all packages/apps
pnpm test:unit      # 108 unit tests (dates, money, pricing, RBAC, tokens, i18n)
pnpm test:integration  # 39 DB tests incl. release-blocking tenant isolation
node scripts/e2e-admin.mjs  # 30-check HTTP E2E (needs running server + seed)
pnpm build          # production builds
```

CI runs all of the above on every pull request (`.github/workflows/ci.yml`).

## Documentation

The engagement's summary — what was built, executed test results, security
posture, credential locations, costs, release state — is
[`docs/COMPLETION_REPORT.md`](docs/COMPLETION_REPORT.md).

Start with [`docs/PRODUCT_OVERVIEW.md`](docs/PRODUCT_OVERVIEW.md) and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Operations:
[`docs/LOCAL_DEVELOPMENT.md`](docs/LOCAL_DEVELOPMENT.md),
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md),
[`docs/DISASTER_RECOVERY.md`](docs/DISASTER_RECOVERY.md). Security:
[`docs/SECURITY.md`](docs/SECURITY.md),
[`docs/MULTI_TENANCY.md`](docs/MULTI_TENANCY.md),
[`docs/SECURITY_REVIEW.md`](docs/SECURITY_REVIEW.md). Store releases:
[`docs/GOOGLE_PLAY_RELEASE.md`](docs/GOOGLE_PLAY_RELEASE.md),
[`docs/APPLE_APP_STORE_RELEASE.md`](docs/APPLE_APP_STORE_RELEASE.md).
