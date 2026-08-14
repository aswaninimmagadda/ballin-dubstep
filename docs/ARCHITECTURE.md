# Architecture

## Shape

```
┌───────────────────────────┐        ┌───────────────────────────┐
│  apps/admin (Next.js)     │        │  apps/member (Expo RN)    │
│  staff PWA + server       │◄──────►│  Android / iOS            │
│  actions + REST for the   │  HTTPS │  Bearer tokens, offline   │
│  member app               │        │  cache                    │
└─────────────┬─────────────┘        └───────────────────────────┘
              │  pg driver, restricted role `gymflow_app`
              │  every tx: set_config('request.jwt.claims', …)
┌─────────────▼─────────────────────────────────────────────────┐
│  PostgreSQL 16                                                │
│  · 37 tables, tenant_id everywhere, FK/CHECK/unique           │
│  · Row-Level Security = the authorization layer               │
│  · SECURITY DEFINER auth functions (login/session/refresh)    │
│  · append-only triggers on payments/receipts/refunds/audit    │
│  · atomic allocators (receipt seq, membership numbers)        │
└───────────────────────────────────────────────────────────────┘
```

One backend serves both apps. The admin app is server-rendered (React Server
Components + server actions, minimal client JS); the member app talks to
`/api/member/v1/*`.

## Key decisions (and why)

1. **Plain PostgreSQL + claims-based RLS, portable to Supabase.**
   Policies read identity from `request.jwt.claims` — exactly the mechanism
   PostgREST/Supabase uses — set per-transaction by the app
   (`packages/database/src/client.ts`). Deploying onto Supabase later means
   pointing the same migrations at a Supabase project; deploying anywhere
   else means any managed Postgres. No proprietary API in business logic.

2. **RLS is the enforcement layer, not WHERE clauses.** The app connects as
   `gymflow_app`, a non-owner role subject to every policy. Even a buggy
   query cannot cross tenants; integration tests prove it as that role.

3. **Application-level auth with database-sealed credentials.** Staff use
   email+password (scrypt, OWASP parameters), sessions are opaque tokens
   stored hashed with server-side revocation. Members use gym-code + mobile
   - password with 15-minute HMAC access tokens and single-use rotating
     refresh tokens (replay revokes the family). The app role has **no direct
     access** to credential tables — only narrow SECURITY DEFINER functions.
     Rationale in `docs/ASSUMPTIONS.md` (no-SMS-cost constraint).

4. **Business rules live in `packages/core`, once.** Expiry arithmetic
   (end-of-month clamping, leap years), grace, freeze extension, renewal
   proposals, pricing/discount/tax, promotion eligibility, receipt-number
   formatting, permission checks, QR pass tokens. The admin server and tests
   consume the same functions; screens never re-derive them.

5. **Money is integer paise everywhere.** `bigint` in the DB, `number`
   (safe-integer-checked) in TS, BigInt for percentage math. Formatting
   divides only at the display edge.

6. **Calendar dates are strings.** Memberships operate on `YYYY-MM-DD` in
   the gym's timezone (Asia/Kolkata default, tenant-configurable). The pg
   driver is configured to return DATE as text; UTC-pinned arithmetic means
   no timezone drift ever touches an expiry date.

7. **Immutable commercial history.** Renewals insert new membership rows
   (chained by `previous_membership_id`); plan-term edits insert new
   `membership_plan_versions`; payments/receipts/refunds/audit are
   append-only via triggers _and_ grants. Corrections are new records.

8. **Derived, never stored, time-based status.** "Expiring soon / grace /
   expired" are computed from dates at read time (`deriveMembershipStatus`),
   so nothing goes stale overnight; only real state transitions
   (sold/frozen/cancelled/renewed) are stored events.

## Request flow (admin example: record payment)

1. Server action validates input with zod (`@gymflow/validation`).
2. `requirePermission('payments.record')` resolves the session → claims.
3. `asPrincipal(claims, fn)` opens a transaction, sets claims, runs:
   member lookup → payment insert (idempotency key) → allocation →
   `app.next_receipt_seq()` (row-locked) → receipt insert → audit insert.
4. RLS checks every statement against the same claims; any violation aborts
   the whole transaction.
5. Errors map to safe user messages (`lib/errors.ts`); technical detail is
   logged server-side only.

## Monorepo

pnpm workspaces (hoisted node-linker for RN/Next compatibility). Shared
packages are consumed as TypeScript source via Next `transpilePackages` and
Metro. One ESLint/Prettier/tsconfig at the root; per-package vitest.

## Phase-2 seams already in place

- `PaymentProvider` boundary: gateway rows would attach to `payments` via
  `external_reference` + a webhook route with idempotent event persistence
  (`notification_deliveries`-style dedupe pattern).
- Notification engine tables (`notification_templates`, `_deliveries` with
  dedupe keys) exist; only the send workers are missing.
- Feature flags are tenant rows read by both apps.
- Entitlements: `tenants.subscription_tier` + flags gate features without
  code removal.
