# Testing

Testing is a release gate, not an afterthought. All counts below are from
actually-executed runs (CI re-runs them on every PR).

## Layers

### 1. Unit tests — 121 passing (vitest, no DB)

| Package             | Tests | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| @gymflow/utils      | 42    | Integer money (rounding, overflow, discount clamps, inclusive/exclusive GST splits, INR formatting/parsing), calendar dates (leap years, end-of-month clamping, timezone boundaries incl. IST-vs-UTC midnight), Indian phone normalization/masking, WhatsApp links                                                                                                                                                                                              |
| @gymflow/core       | 64    | Expiry calculation (1/3/6/12-month, Jan-31 starts, leap Februarys, day-based trials), grace, freeze extension (incl. the 15-day scenario), renewal proposals (seamless/lapsed/override/end-of-month), derived status + check-in gating, pricing quotes (promo kinds, over-discount clamps, tax), promotion eligibility (all rejection reasons), receipt/fiscal-year formatting, QR pass tokens (rotation, replay, tamper, wrong secret, no PII), scrypt hashing |
| @gymflow/validation | 10    | Member/sale/payment/import/login schemas, E.164 transforms, idempotency-key requirement, float rejection                                                                                                                                                                                                                                                                                                                                                        |
| @gymflow/i18n       | 5     | Telugu/English key parity (fails the build if a key is missed), template rendering. Paired with `scripts/check-i18n-coverage.mjs` in CI, which fails if a user-visible string is hard-coded in a page instead — the parity test cannot see a string that never reached a resource file                                                                                                                                                                          |

### 2. Integration tests — 60 passing (vitest + real Postgres, as the runtime role)

`packages/database/test/`:

- **tenant-isolation** (15) — the release-blocking suite; see MULTI_TENANCY.md.
- **permissions** (7) — receptionist vs accountant vs owner write gates,
  refund authorization, instant deactivation.
- **financial-integrity** (7) — append-only payments/receipts/audit, legal
  status transitions, DB-level over-refund guard (incl. concurrent refunds).
- **concurrency** (5) — 20 parallel receipt allocations unique+sequential,
  per-tenant sequences, idempotent payment double-click, one-running-
  membership invariant, membership-number allocation under concurrency.
- **auth-functions** (11) — sealed credential tables, session lifecycle,
  refresh rotation + replay family revocation, throttling counters,
  password-set scoping (members.edit cannot touch staff logins), and
  identifier-vs-IP failure counts staying separate so a shared gym address
  cannot lock everyone out.
- **branch-scoping** (4) — staff restricted via `staff_branch_access` see
  only their branch's members/payments; unrestricted staff see all.
- **privilege-escalation** (11) — the paths found in the pre-release security
  review, each of which worked before it was fixed: a user rewriting their own
  `kind`/`tenant_id`, a member promoting itself to staff through the OR'd
  `WITH CHECK` of a second permissive policy, a receptionist aiming member-app
  credential issuance at the owner's login (on both INSERT and UPDATE), and
  refresh rotation surviving a tenant suspension. A benign self-update is
  asserted to still work, so the fix is not just "deny everything".

Each run drops and remigrates `gymflow_test`, then builds **two** complete
tenants — so migrations themselves are exercised constantly.

### 3. End-to-end — 270 checks passing (three HTTP suites)

`scripts/e2e-admin.mjs` (112 checks) drives the real HTTP surface (server
actions via progressive-enhancement form posts) against a running server +
seeded DB, then verifies database effects:

- **Scenario 1 — new member:** login → duplicate check → onboarding →
  3-month sale with joining fee → cash payment → expiry `start+3m-1d` →
  ₹3,000 total → receipt `SVF-YYYY-NNNNNN` → **PT 8-sessions add-on with
  its own payment/receipt** → in-app payment notification queued.
- **Check-in:** success, duplicate-tap guard, exactly one attendance row.
- **Member app activation:** reception enables app access (one-time
  password), member logs into the API, `/me` shows the sold membership,
  notifications visible.
- **Scenario 2 — renewal:** 6-month renewal with `NEWYEAR26` → 10% discount
  applied and redemption recorded → starts day after current expiry → UPI
  payment → replayed form (same idempotency key) does **not** create a third
  membership → check-in still allowed (the running membership governs the
  gate, not the pending renewal).
- **Scenario 3 — freeze:** receptionist blocked (RBAC) → manager freezes →
  renewal stays pending → unfreeze after 15 days → expiry extended by 15.
- **Authorization:** anonymous page/API access rejected; receptionist
  blocked from audit.
- **Refunds:** a refund is recorded, then the payments export shows the
  refunded and net amounts and the reports page surfaces the refund — the
  money that came back must leave the collections figure.
- **Member edit:** a landline is accepted as an emergency contact, and a
  field blanked on the form is genuinely cleared (not silently ignored).
- **Own password:** wrong current password refused; a successful change ends
  every session, the old password stops working and the new one works.

`scripts/e2e-acceptance.mjs` (137 checks) executes the brief's **final
acceptance test (§82)** end to end: a second gym is provisioned purely via
platform tooling (`create-tenant` CLI — zero source changes), its owner
configures settings/plan/PT package/trainer/staff/promotion over HTTP, a
Gym-B receptionist onboards → sells with a 20% promotion → adds PT → takes
payments (receipts under Gym B's own `HFT-` prefix, sequence starting at 000001) → checks in; the member is edited + branch-transferred; the member
app logs in with Gym B's code and sees Gym B branding + correct expiry; the
WhatsApp link renders Gym B's customized template; renew/freeze/unfreeze
succeed; the cancel page offers a picker while a running membership and a
pre-sold pending renewal coexist, cancelling only the pending one keeps the
member active, cancelling the last live one marks them cancelled, and the
member is then archived (soft delete — history kept, mobile freed); CSV
import blocks on invalid rows then imports clean rows with receipts; the
daily sweep activates a due pre-sold membership; an unpaid renewal is refused
while part payments are off, then enabled so a deposit leaves a balance that
shows in the dues filter and the dues export; reports/exports are
tenant-pure. Isolation is then proven from both directions over HTTP
(cross-tenant member page 404s, exports contain zero foreign rows, plans
and receipt prefixes differ, member credentials are tenant-scoped).
**Scenario 4 — tenant isolation** is additionally covered at the database
layer by the integration suite (two-tenant fixture, attacks from both
sides) on every CI run.

It also proves the two operations a gym cannot open without: a **GST tax
invoice** (18% inclusive plan → the sale snapshots ₹1,800 tax on ₹11,800, the
receipt prints GSTIN, SAC 999723, taxable value ₹10,000 and CGST/SGST of ₹900
each, a malformed GSTIN is refused, and a gym with no GSTIN still prints a
plain acknowledgement with no CGST line), and **support recovery** of a gym
whose only owner is locked out (the operator CLI issues a new password, the
old one stops working, and the reset lands in that gym's audit log).

`scripts/e2e-empty-tenant.mjs` (21 checks) is the day-one test: a
freshly-provisioned gym with no members, no plans and no payments. Every page
and every export must render rather than divide by zero or 500.

Run locally: seed + `pnpm --filter @gymflow/admin start` + `node
scripts/e2e-admin.mjs` + `node scripts/e2e-acceptance.mjs` + `node
scripts/e2e-empty-tenant.mjs`.

### 3b. Performance probe — `scripts/perf-probe.mjs`

Builds a 5,000-member tenant, measures the admin app's hot queries through
RLS as the runtime role, and rolls the whole fixture back. Fails the run if
any query exceeds `PERF_BUDGET_MS` (250 ms), so it works as a regression
gate. Current slowest: 69 ms. See docs/PERFORMANCE.md for what it found and
why the numbers used to be 15-45x worse.

### 3b-2. Backup restore drill — `ops/restore-test.sh`

Restores a dump into a scratch database, then connects **as the application
role with tenant claims** and reads real rows through RLS. That last step is
the point: the previous check ran `pg_restore --list`, which parses the archive
header and proves nothing about whether the application can use the result.
Roles are cluster-level and `pg_dump` never emits them, so a restore that
"succeeded" left ~70 GRANTs failing and no `gymflow_app` role — every row
present, none readable. The script refuses a dump with no roles file beside it,
and never alters the live role's password.

### 3c. Android release check — `scripts/check-android-manifest.mjs`

21 assertions about the binary and the release configuration rather than the source, run in CI. `expo
export` only proves the JavaScript bundles; permissions, the splash screen,
edge-to-edge and the release-origin guard live in the Android project, which
nothing in the pipeline used to generate. It runs `expo prebuild` and asserts
that only INTERNET and VIBRATE survive into the release manifest (storage and
draw-over-other-apps are stripped), that the splash and adaptive icons are
produced, that cleartext is off for an https origin, that the app uses
`react-native-safe-area-context` rather than react-native's deprecated
`SafeAreaView` (a plain View on Android, where edge-to-edge is mandatory), and
that a production build is **refused** when `GYMFLOW_API_URL` is still the
eas.json placeholder or is plain http.

It does not replace a run on a real device — see `docs/KNOWN_LIMITATIONS.md`.

The performance probe also builds three years of check-ins (2.34M attendance
rows at the 5,000-member scale), because the two screens reception looks at all
day read that table and the probe previously never touched it.

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
Also automated: branch transfer (acceptance suite edits a member onto a
second branch), pending-renewal cancellation, member archive, the daily
state sweep, refund over-payment guard (DB trigger, concurrent case).
Covered by design + manual test: deactivated plan (latest-version lookup
refuses inactive plans with a friendly error), offline member app (stale
banner), slow API (server-rendered admin degrades gracefully). Not yet
automated: partial payments (flag off by default), trainer deletion with
open sessions (restrict-by-FK — deactivate instead). Tracked in
KNOWN_LIMITATIONS.md.
