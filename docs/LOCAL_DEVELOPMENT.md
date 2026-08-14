# Local Development

## Prerequisites

- Node.js ≥ 20 (22 recommended), pnpm ≥ 9 (`corepack enable`)
- PostgreSQL 16 running locally
- For the member app: Expo Go on a device, or an Android emulator

## One-time setup

```bash
git clone <repo> && cd <repo>
pnpm install

# Databases + owner role
sudo -u postgres psql \
  -c "CREATE ROLE gymflow LOGIN PASSWORD 'gymflow_dev_pw' SUPERUSER" \
  -c "CREATE DATABASE gymflow_dev OWNER gymflow" \
  -c "CREATE DATABASE gymflow_test OWNER gymflow"

# Apply migrations (creates the runtime role gymflow_app) and seed the demo gym
DATABASE_URL=postgres://gymflow:gymflow_dev_pw@localhost:5432/gymflow_dev pnpm db:migrate
DATABASE_URL=postgres://gymflow:gymflow_dev_pw@localhost:5432/gymflow_dev pnpm db:seed
sudo -u postgres psql -c "ALTER ROLE gymflow_app PASSWORD 'gymflow_app_dev_pw'"
```

Optional (recommended for anything shared): `SEED_PASSWORD=… SEED_MEMBER_PASSWORD=…`
before `db:seed` to avoid the dev-default demo passwords.

## Admin app

```bash
cat > apps/admin/.env.local <<'EOF'
DATABASE_APP_URL=postgres://gymflow_app:gymflow_app_dev_pw@localhost:5432/gymflow_dev
SESSION_SECRET=<openssl rand -hex 32>
MEMBER_TOKEN_SECRET=<openssl rand -hex 32>
EOF
pnpm dev:admin        # http://localhost:3000  (login: reception@demo.gymflow.local)
```

## Member app

```bash
pnpm dev:member       # Expo dev server; scan the QR with Expo Go
```

Point the app at your machine: edit `apps/member/app.json` →
`expo.extra.apiBaseUrl` to `http://<your-LAN-IP>:3000` (the phone must reach
the admin server). Login: gym code `apfitness`, mobile `9876543210`,
password = `SEED_MEMBER_PASSWORD`.

## Everyday commands

```bash
pnpm typecheck | pnpm lint | pnpm format | pnpm test
pnpm test:unit            # fast, no DB
pnpm test:integration     # uses gymflow_test (auto reset+migrate per run)
pnpm db:reset             # drop + remigrate DATABASE_URL (refuses URLs containing "prod")
node scripts/e2e-admin.mjs   # HTTP E2E against the running dev server + seed
```

Integration tests default to
`postgres://gymflow:gymflow_dev_pw@localhost:5432/gymflow_test` (owner) and
`postgres://gymflow_app:gymflow_app_dev_pw@localhost:5432/gymflow_test`
(runtime role); override with `TEST_DATABASE_URL` / `TEST_DATABASE_APP_URL`.

## Conventions

- Migrations are append-only once merged; add a new file, never edit an
  applied one.
- New tenant-owned tables must follow the checklist in `MULTI_TENANCY.md`.
- Visible strings go through `@gymflow/i18n` (the completeness test fails if
  Telugu falls behind).
- Money is integer paise end to end; dates are `YYYY-MM-DD` strings.
