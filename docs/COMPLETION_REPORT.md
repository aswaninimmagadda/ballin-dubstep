# Completion Report (§87)

The single aggregation document for the engagement: what was built, how it
is shaped, what was actually executed and proven, where the keys live, what
it costs, what ships to stores, what is honestly missing, and what to do
next. Every claim below links to the artifact that backs it — nothing here
is asserted without a test, migration, or document behind it.

## 1. What was built

A production-ready, multi-tenant gym management SaaS for the Indian market
(Andhra Pradesh pilot, English + Telugu), working name **GymFlow**:

- **Admin web app** (Next.js 15 PWA, installable, offline-aware) for gym
  staff: dashboard with expiry queue and collections, member onboarding
  with duplicate detection, plan/pricing management with versioned history,
  membership sale/renewal/freeze/unfreeze/cancel/archive, manual payments
  (cash/UPI-reference) with concurrency-safe receipts, refunds with a
  DB-level over-refund guard, promotions engine, leads CRM, attendance
  with rotating-QR scanning, PT add-ons with session logging, staff and
  trainer management, WhatsApp deep-link renewals (editable EN/TE
  templates), CSV import (dry-run, digest-checked, PII never in URLs),
  CSV exports (formula-injection hardened), reports, audit log, feature
  flags, bilingual UI.
- **Member Android app** (Expo/React Native): login by gym code + mobile,
  membership status with live-derived expiry, rotating QR pass (60-second
  HMAC window, no PII in the token), payment/receipt history, attendance
  history, in-app notifications, per-gym branding.
- **Platform tooling**: `create-tenant` CLI provisions a complete new gym
  (tenant, branch, branding, settings, flags, roles, owner login) with
  zero source changes — proven by the automated acceptance suite; daily
  `sweep` job trues up stored membership states.
- **Database**: PostgreSQL with row-level security enforced from the first
  migration; 12 migrations, 39 tables; append-only financial history;
  sealed authentication path (the app role cannot read credential tables).

## 2. Architecture (summary — full detail in ARCHITECTURE.md)

pnpm monorepo. Shared packages (`packages/`): `types`, `utils` (integer
paise money, IST-aware date engine), `core` (pricing, renewal, status
derivation, scrypt, QR tokens), `validation` (zod), `i18n` (EN/TE parity
enforced by test), `config`, `database` (migrations, seed, CLI, tests).
Apps (`apps/`): `admin` (Next.js App Router, server components + server
actions, PWA), `member` (Expo). Security model: the app connects as a
restricted `gymflow_app` role; every transaction carries JWT-style claims
via `set_config`; RLS policies + `SECURITY DEFINER` helpers enforce
tenant, permission and branch scoping **in the database**, so no query
can cross tenants even if application code is wrong. Money is integer
paise end to end; financial rows are append-only (triggers + revoked
DELETE); receipts allocate from row-locked per-tenant/fiscal-year
sequences. See MULTI_TENANCY.md, DATABASE_SCHEMA.md, SECURITY.md, RBAC.md.

## 3. Repository structure

```
supabase/migrations/   12 SQL migrations (schema → RLS → auth → hardening)
packages/              7 shared workspace packages (see above)
apps/admin             staff PWA + member-facing HTTP API (/api/member/v1)
apps/member            Expo Android app
scripts/               e2e-admin.mjs, e2e-acceptance.mjs (HTTP suites)
docs/                  20 documents (this file included)
.github/workflows/     CI gate
```

## 4. URLs / endpoints

Self-hosted; no fixed production URLs yet. Admin app serves staff UI at
`/`, one-time credentials at `/credentials` (POST-rendered, no-store),
member API under `/api/member/v1/*` (login, refresh, me, payments,
attendance, pt, notifications, pass), exports under `/api/export/*`.
Deployment targets and domain guidance: DEPLOYMENT.md.

## 5. Actual test results (executed 2026-08-14, all green)

| Layer                      | Count                   | Command                                |
| -------------------------- | ----------------------- | -------------------------------------- |
| Unit (vitest)              | **108 passed**          | `pnpm test:unit`                       |
| Integration (real PG, RLS) | **49 passed**           | `pnpm --filter @gymflow/database test` |
| E2E admin HTTP suite       | **50 checks passed**    | `node scripts/e2e-admin.mjs`           |
| E2E final acceptance (§82) | **55 checks passed**    | `node scripts/e2e-acceptance.mjs`      |
| Typecheck / lint / format  | clean                   | `pnpm typecheck && pnpm lint`          |
| Production builds          | admin ✓, member Metro ✓ | CI steps                               |

The §82 acceptance run provisions a second gym purely via platform
tooling, configures it over HTTP, runs the full member lifecycle
(onboard → sell with promotion → PT → check-in → app activation → edit +
branch transfer → renew → freeze → unfreeze → cancel pending → cancel
running → archive), imports CSV (bad file blocked, good file imported),
runs the sweep, and proves **bidirectional tenant isolation** over HTTP.
Tenant isolation is additionally attacked at the DB layer by the
15-test release-blocking integration suite on every CI run. A real
`pg_dump`/restore drill was executed (row counts matched, RLS held on the
restored DB) — see DISASTER_RECOVERY.md. Details: TESTING.md.

## 6. Security summary (full review in SECURITY_REVIEW.md)

- RLS on every tenant table; claims are transaction-scoped; two-tenant
  attack suite is release-blocking in CI.
- Credentials sealed behind `SECURITY DEFINER` functions — the runtime
  role cannot SELECT password hashes; scrypt (N=2¹⁵) with NFKC
  normalization; login throttling; rotating refresh tokens with
  replay-revokes-family; session tokens stored hashed.
- Granular RBAC (permission keys, no role-name checks in UI), branch-level
  scoping enforced in RLS, discount-approval threshold, manager-gated
  overrides, append-only audit log with IP/user-agent.
- One-time passwords render once in a POST response — never in URLs, and
  the holder can rotate them at `/account/password`.
- Login throttling counts identifier and IP failures separately, so one
  member's forgotten password cannot lock out a gym behind a shared address.
- Collections are reported net of refunds; unpaid balances are visible on
  the member page, the members list, a dashboard tile and a dues export.
- QR pass: 60-second rotating HMAC, no PII; server-side verification.
- No secrets in the repo (`.env.example` documents every variable).

## 7. Credential configuration locations (no secrets in repo)

| What                      | Where                                                                |
| ------------------------- | -------------------------------------------------------------------- |
| DB app-role URL           | `DATABASE_APP_URL` env (host dashboard/CI)                           |
| DB owner URL (migrations) | `DATABASE_URL` env — operator/CI only, never app                     |
| Session signing secret    | `SESSION_SECRET` env (32+ random bytes)                              |
| Member token/QR secret    | `MEMBER_TOKEN_SECRET` env (rotation invalidates passes)              |
| Seed demo passwords       | `SEED_PASSWORD` / `SEED_MEMBER_PASSWORD` env                         |
| New-gym owner password    | printed once by `create-tenant` (or `--owner-password`, discouraged) |
| Play/EAS signing          | EAS-managed; never committed (GOOGLE_PLAY_RELEASE.md)                |

## 8. Hosting costs

Pilot: ₹0/month recurring (Supabase free + Vercel Hobby + no SMS
provider), with the concrete first paid thresholds and the ₹400-500/mo VPS
alternative documented in DEPLOYMENT.md §Cost picture. Store costs:
US$25 one-time (Google Play), US$99/yr (Apple, only when iOS ships).

## 9. Android / iOS release state

- **Android**: JS bundle export verified in CI; package id, adaptive icon
  and splash configured. AAB **not yet generated** — requires the human
  owner's Expo/EAS account and production API origin. The full 13-step
  path (account → rollout → updates) is GOOGLE_PLAY_RELEASE.md.
- **iOS**: deferred by scope decision; preparation state and steps in
  APPLE_APP_STORE_RELEASE.md.

## 10. Known limitations

Maintained honestly in KNOWN_LIMITATIONS.md (18 items) — headline ones:
manual payments only (no gateway), no self-serve password reset, member
app is Android-only in this cut, platform console is a CLI, reports are
the operational core set.

## 11. Phase-2 recommendations

Prioritized in ROADMAP.md: payment gateway (abstraction + idempotent
webhooks designed), WhatsApp Business API sender over the existing
notification tables, platform web console, member self-serve renewals,
owner analytics (churn/renewal-rate), class scheduling/capacity, edge
rate limiting, Playwright browser layer on top of the HTTP E2E suites.

## 12. Handover checklist for the owner

1. Create the production DB, run `pnpm db:migrate`, set the `gymflow_app`
   password (DEPLOYMENT.md).
2. Set the four runtime secrets on the host; deploy the admin app.
3. Schedule the two cron jobs (sweep + backup) and run the restore drill
   once against production backups (DISASTER_RECOVERY.md).
4. Provision the first real gym with `create-tenant`; hand the printed
   owner password to the gym owner; they change it on first login.
5. When ready to ship the member app: follow GOOGLE_PLAY_RELEASE.md.
