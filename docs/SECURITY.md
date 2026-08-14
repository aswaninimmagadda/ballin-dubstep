# Security

Threat model: hostile internet traffic, curious/compromised tenant staff,
tenant-vs-tenant data exposure, stolen member phones, leaked client bundles.
The database is the last line of defense and is treated as such.

## Authorization

- Tenant isolation and granular permissions enforced by RLS as the
  restricted `gymflow_app` role — see `MULTI_TENANCY.md`, `RBAC.md`.
- Branch scoping supported via `staff_branch_access`.
- API routes and server actions re-check permissions for clear errors, but
  the database decision is authoritative.

## Authentication

**Staff (admin web):** email + password. scrypt (N=2¹⁵, r=8, p=1, 16-byte
salt, NFKC normalization, self-describing hash format for future parameter
raises). Opaque 256-bit session tokens stored **hashed** (SHA-256) with
expiry, revocation, IP/UA metadata; HttpOnly/SameSite=Lax/Secure cookies.
Login throttling: 8 failed attempts per identifier-or-IP per 15 minutes
(server-side table, tested).

**Members (mobile):** gym code + mobile + password (min 6, server-hashed
identically). 15-minute HMAC-SHA256 access tokens; 30-day single-use
refresh tokens stored hashed — reuse of a consumed token revokes the whole
family (replay defense, tested). Tokens live in the OS keystore
(expo-secure-store), never AsyncStorage.

**Credential isolation:** the runtime role has **no SELECT/INSERT** on
`user_credentials`, `sessions`, `refresh_tokens`, `login_attempts`. All
access flows through narrow SECURITY DEFINER functions that return at most
one identified row (`app.auth_staff_lookup`, `app.session_lookup`, …) —
there is no code path that can list password hashes.

## Input handling

- Every externally-controlled write is validated server-side with zod
  (`@gymflow/validation`) — lengths, formats, enums, phone normalization,
  integer-money.
- SQL injection: parameterized queries only (pg placeholders); no string
  concatenation of user input into SQL.
- XSS: React escaping everywhere; no `dangerouslySetInnerHTML` in the
  codebase.
- CSRF: session cookie is SameSite=Lax; mutations are Next server actions
  (origin-checked by the framework) — no state-changing GETs.
- IDOR: object references are UUIDs _and_ every row access passes RLS, so
  guessing IDs yields nothing (tested with exact foreign UUIDs).
- Mass assignment: inputs pass through explicit zod schemas; inserts list
  columns explicitly.
- Replay/double submit: idempotency keys on sales/renewals/payments with
  unique indexes; duplicate check-in window; QR pass tokens expire in ≤2
  minutes and are HMAC-bound to the member.
- Brute force: throttling above + generic error messages (no user
  enumeration; unknown email and wrong password are indistinguishable).

## Secrets

- No secrets in the repository — verified by scan (see SECURITY_REVIEW.md).
- `.env.example` documents every variable; real values live in the host's
  secret store. `.gitignore` excludes `.env*`, keys, keystores.
- Client bundles contain no provider credentials: the member app holds only
  its own user's tokens; the admin browser holds only the session cookie.
- Service-role/database-owner credentials are used exclusively by
  migrations/seeds, never by the running apps.

## Headers & transport

`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, restricted
Permissions-Policy, no `x-powered-by`. TLS is provided by the hosting layer
(see DEPLOYMENT.md); cookies are `secure` in production.

## Financial integrity

Payments/receipts/refunds/audit are append-only via triggers **and** the
DELETE grant is revoked at the role level. The single allowed mutation is
payment status → refunded/partially_refunded. Refund totals cannot exceed
the payment. Receipt numbers allocate under row locks (concurrency-tested).

## Observability without PII

Server logs technical errors (`lib/errors.ts` boundary); user-facing
messages are generic. Phone numbers are masked (`98765xxxxx`) in list
views and audit payloads. Passwords/OTP/tokens are never logged. Audit
`before/after` snapshots are explicitly redacted by callers.

## Known gaps (tracked)

See `KNOWN_LIMITATIONS.md` and `SECURITY_REVIEW.md` — notably: no MFA yet,
no self-serve password reset (staff reset via owner; members via reception),
rate limiting is per-instance DB-backed (fine at pilot scale), file/photo
upload not yet implemented (so no upload attack surface), platform-admin
tenant administration happens via SQL runbook rather than UI.
