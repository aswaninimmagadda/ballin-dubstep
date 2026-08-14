# Testing

Testing is a release gate, not an afterthought. All counts below are from
actually-executed runs (CI re-runs them on every PR).

## Layers

### 1. Unit tests — 108 passing (vitest, no DB)

| Package             | Tests | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| @gymflow/utils      | 35    | Integer money (rounding, overflow, discount clamps, inclusive/exclusive GST splits, INR formatting/parsing), calendar dates (leap years, end-of-month clamping, timezone boundaries incl. IST-vs-UTC midnight), Indian phone normalization/masking, WhatsApp links                                                                                                                                                                                              |
| @gymflow/core       | 58    | Expiry calculation (1/3/6/12-month, Jan-31 starts, leap Februarys, day-based trials), grace, freeze extension (incl. the 15-day scenario), renewal proposals (seamless/lapsed/override/end-of-month), derived status + check-in gating, pricing quotes (promo kinds, over-discount clamps, tax), promotion eligibility (all rejection reasons), receipt/fiscal-year formatting, QR pass tokens (rotation, replay, tamper, wrong secret, no PII), scrypt hashing |
| @gymflow/validation | 10    | Member/sale/payment/import/login schemas, E.164 transforms, idempotency-key requirement, float rejection                                                                                                                                                                                                                                                                                                                                                        |
| @gymflow/i18n       | 5     | Telugu/English key parity (fails the build if a key is missed), template rendering                                                                                                                                                                                                                                                                                                                                                                              |

### 2. Integration tests — 39 passing (vitest + real Postgres, as the runtime role)

`packages/database/test/`:

- **tenant-isolation** (15) — the release-blocking suite; see MULTI_TENANCY.md.
- **permissions** (7) — receptionist vs accountant vs owner write gates,
  instant deactivation.
- **financial-integrity** (5) — append-only payments/receipts/audit, legal
  status transitions.
- **concurrency** (5) — 20 parallel receipt allocations unique+sequential,
  per-tenant sequences, idempotent payment double-click, one-running-
  membership invariant, membership-number allocation under concurrency.
- **auth-functions** (7) — sealed credential tables, session lifecycle,
  refresh rotation + replay family revocation, throttling counters.

Each run drops and remigrates `gymflow_test`, then builds **two** complete
tenants — so migrations themselves are exercised constantly.

### 3. End-to-end — 30 checks passing (`scripts/e2e-admin.mjs`)

Drives the real HTTP surface (server actions via progressive-enhancement
form posts) against a running server + seeded DB, then verifies database
effects:

- **Scenario 1 — new member:** login → duplicate check → onboarding →
  3-month sale with joining fee → cash payment → expiry `start+3m-1d` →
  ₹3,000 total → receipt `SVF-YYYY-NNNNNN`.
- **Check-in:** success, duplicate-tap guard, exactly one attendance row.
- **Scenario 2 — renewal:** 6-month renewal with `NEWYEAR26` → 10% discount
  applied and redemption recorded → starts day after current expiry → UPI
  payment → replayed form (same idempotency key) does **not** create a third
  membership.
- **Scenario 3 — freeze:** receptionist blocked (RBAC) → manager freezes →
  renewal stays pending → unfreeze after 15 days → expiry extended by 15.
- **Authorization:** anonymous page/API access rejected; receptionist
  blocked from audit.
- **Scenario 4 — tenant isolation** is covered by the integration suite
  (two-tenant fixture, attacks from both sides) on every CI run.

Run locally: seed + `pnpm --filter @gymflow/admin start` + `node
scripts/e2e-admin.mjs`.

### 4. Manual smoke script

After any deploy: login each role, dashboard numbers sane, sell + receipt
print, member app login + QR scan at reception, WhatsApp link opens with
rendered template, CSV export downloads.

## Edge-case matrix status

Covered by automated tests: duplicate mobile, expired/inactive/limit-reached
promotion, discount > amount, payment > balance, repeated payment
submission, double-click renewal, concurrent receipts, leap-year and
end-of-month dates, frozen-membership check-in warning, deactivated staff,
unauthorized API access, stale/forged claims, refresh-token replay.
Covered by design + manual test: deactivated plan (latest-version lookup
refuses inactive plans with a friendly error), branch transfer (edit member
branch), offline member app (stale banner), slow API (server-rendered admin
degrades gracefully). Not yet automated: partial payments (flag off by
default), trainer deletion with open sessions (restrict-by-FK — deactivate
instead). Tracked in KNOWN_LIMITATIONS.md.
