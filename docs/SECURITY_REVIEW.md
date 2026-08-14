# Security Review (pre-handover)

Date: 2026-08-14 · Scope: full repository at handover · Method: automated
scans + manual checklist + the adversarial test suites (which run in CI).

## Checklist results

| Area                         | Result             | Evidence                                                                                                                                                                                                                                                         |
| ---------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exposed secrets in repo      | **PASS**           | `git grep` for key/credential patterns → only `.env.example` placeholders and i18n label strings. No `.env*` files tracked. No keystores/PEMs.                                                                                                                   |
| Service-role keys in clients | **PASS**           | Apps use only `DATABASE_APP_URL` (restricted role); owner URL confined to migrations/CI. Member app bundles zero server secrets (verified in exported Hermes bundle inputs — env module reads server-side only).                                                 |
| Debug/test accounts          | **PASS with note** | Demo accounts exist only via the seed, which refuses to run twice and warns loudly on default passwords; production runbook says never seed production.                                                                                                          |
| Open storage                 | **N/A**            | No object storage in MVP (photos deferred).                                                                                                                                                                                                                      |
| Overly broad RLS             | **PASS**           | Policy-by-policy read-through of 0003; every staff policy requires tenant match **and** a permission; member policies are self-scope SELECT-only; platform policies require a real platform_admin row. Fail-closed default (RLS enabled, no policy = no access). |
| Tenant leakage               | **PASS**           | 15-test isolation suite as the runtime role, incl. forged-claims and exact-UUID probes; two-tenant fixture.                                                                                                                                                      |
| XSS                          | **PASS**           | No `dangerouslySetInnerHTML`/`eval` (scanned); React escaping; templates render to plain text in `wa.me` URLs (URL-encoded).                                                                                                                                     |
| Insecure deep links          | **PASS**           | Only outbound `tel:`/`wa.me` links built from validated E.164 numbers; member-app scheme `gymflow` carries no auth material.                                                                                                                                     |
| Insecure token storage       | **PASS**           | Member tokens in SecureStore (OS keystore); admin session in HttpOnly cookie; DB stores only SHA-256 hashes of session/refresh tokens.                                                                                                                           |
| Missing rate limits          | **PASS with note** | Login throttling both surfaces (8/15min, tested). Note: general API rate limiting is not implemented — acceptable at pilot scale behind host-level protections; revisit before public scale-out.                                                                 |
| Console logging of PII       | **PASS**           | Scan of `console.*` for password/token/secret → only the seed's instructional message. Error boundary logs technical messages, not payloads; phones masked in UI/audit.                                                                                          |
| Dangerous admin endpoints    | **PASS**           | Every route/action goes through `requirePermission`/`memberAuth`; exports permission-gated + audited; no unauthenticated mutation endpoints exist.                                                                                                               |
| Unprotected exports          | **PASS**           | 401 anonymous / 403 without `reports.export` (E2E-tested), rows RLS-scoped, download audited.                                                                                                                                                                    |
| CSRF                         | **PASS**           | SameSite=Lax cookie + server-action origin checks; no state-changing GETs.                                                                                                                                                                                       |
| SQL injection                | **PASS**           | Parameterized queries throughout; the one dynamic identifier (`exportCsv`) selects from a hardcoded map.                                                                                                                                                         |
| Financial mutability         | **PASS**           | Trigger + grant-level append-only, integration-tested even for owner and platform roles.                                                                                                                                                                         |

## Dependency audit (`pnpm audit --prod`)

8 advisories, all in **transitive build/dev-time tooling**, none reachable
from runtime request paths:

| Advisory                 | Path           | Assessment                                                                                                                                                                                                                                             |
| ------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| sharp/libvips (high)     | `next>sharp`   | Image optimizer; app serves no user-uploaded images (feature deferred). Fixed by the next Next.js release train; not independently overridable without forking Next's pin.                                                                             |
| postcss ×4 (high/mod)    | `next>postcss` | Build-time CSS processing of our own stylesheets only; no untrusted CSS input. A pnpm override to ≥8.5.18 was trialled and reverted — it destabilized React dedup in the hoisted workspace; risk accepted as build-time-only, revisit on Next upgrade. |
| image-size ×2 (high DoS) | `expo>metro`   | Metro dev/bundling tool, not shipped code.                                                                                                                                                                                                             |
| uuid (moderate)          | `expo>xcode`   | iOS config plugin, build-time only.                                                                                                                                                                                                                    |

Action: track Next.js/Expo patch releases; re-run `pnpm audit` in CI
monthly (manual for now).

## Adversarial tests that gate release (run in CI)

Tenant isolation (15) · permission gates (7) · financial immutability (5) ·
concurrency/idempotency (5) · sealed auth path incl. refresh replay (7) ·
HTTP authorization checks in the E2E suite (4).

## Open items (accepted for pilot, tracked in KNOWN_LIMITATIONS)

1. No MFA for staff (Phase 2 TOTP).
2. No self-serve password reset (owner/reception-mediated; audited).
3. Per-instance DB-backed throttling only (add edge rate limiting before
   multi-instance scale).
4. Platform-admin operations via SQL runbook (UI in Phase 2; policies
   already restrict to real platform admins).

**Conclusion:** no critical or high findings open in first-party code; the
release-blocking requirements (tenant isolation, financial integrity,
secret hygiene) are enforced by automated tests, not by policy documents.
