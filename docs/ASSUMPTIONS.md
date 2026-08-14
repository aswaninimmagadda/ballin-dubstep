# Assumptions & Decisions

Recorded where the brief left room for judgement. Priority order applied:
security/data correctness → tenant isolation → financial correctness → ease
of operation → reliability → maintainability → performance → polish.

1. **Backend = plain PostgreSQL with Supabase-compatible RLS claims,
   application server owns auth.** The brief recommended Supabase; it also
   required portability, a no-cost pilot and no insecure custom auth. The
   claims mechanism is byte-compatible with Supabase's
   (`request.jwt.claims`), so Supabase hosting remains a drop-in, while
   local dev/CI/tests run on vanilla Postgres. Auth uses vetted primitives
   (scrypt via Node crypto, hashed opaque sessions, rotating refresh
   tokens) rather than an invented scheme.

2. **Member authentication = gym code + mobile + password (no OTP).** An
   SMS provider costs money and needs a DLT registration in India; the
   brief allows a password option if done safely. Passwords are set by
   reception at onboarding (or reset there in person — an acceptable flow
   for a small gym where members are known faces). OTP slots in later
   behind the same `auth_member_lookup` seam.

3. **One shared member app with tenant-aware branding** (gym code at login;
   brand colors/logo/support contacts from the API) — no per-gym forks.

4. **Renewal semantics:** renewing before expiry starts the day after
   current expiry (seamless); renewing after expiry starts today (lapsed
   days are not sold). Joining fee is charged on first sale only, never on
   renewals. An early renewal coexists with the running membership as
   `pending` (DB invariant: max one running + one pending per member).

5. **Freeze semantics:** freeze days = calendar days from freeze start to
   actual return (min 1); expiry extends by exactly those days when the
   freeze is marked as extending. Freezing requires the
   `memberships.freeze` permission (manager+ by default). Config caps
   (max freezes/days per year) are stored per tenant and per plan; the MVP
   warns via plan limits rather than hard-blocking medical exceptions.

6. **Fiscal year for receipt numbering = Indian FY (Apr–Mar)**, label =
   starting year: `SVF-2026-000123`.

7. **Tax defaults to 0% inclusive.** Most small AP gyms are under the GST
   composition/threshold; rates are per-plan-version fields
   (`tax_rate_bps`, `tax_inclusive`) when a gym needs them.

8. **Derived statuses are computed at read time** (expiring soon/grace/
   expired) rather than by a nightly job — nothing can go stale; stored
   states change only on real actions. A later cron can additionally flip
   long-expired rows for reporting hygiene.

9. **"Expiring soon" = 7 days** by default; dashboard queue shows -7…+7
   days. Reminder intervals are stored per tenant (`expiry_reminder_days`)
   for the Phase-2 notification engine.

10. **Attendance without hardware:** reception search or member-shown QR
    scanned/typed at the desk. The QR is a 60-second HMAC token (member
    UUID only, no PII), verified server-side; turnstile/biometric
    integrations are Phase 3.

11. **Health data:** deliberately minimal — emergency contact only. No
    medical fields collected in the MVP (privacy-by-default); the
    `members.health.view` permission exists for when a tenant later opts
    into an injury-note field.

12. **Member photos/documents deferred.** No file upload surface in the
    MVP (removes an entire attack class); schema keeps `photo_path`
    columns for the Phase-2 signed-URL implementation.

13. **Navigation in the member app is a lightweight custom tab shell**
    instead of expo-router: five screens, zero extra native deps, smaller
    binary, fewer version constraints. Revisit when screen count grows.

14. **Platform-admin operations (create tenant, suspend, flags) are a SQL
    runbook** in the MVP (see GYM_OWNER_GUIDE.md appendix) — the role,
    policies and data model are done; the UI is Phase 2. No impersonation
    feature, per the brief.

15. **CSV import (notebook migration)** ships as a validated template +
    documented dry-run flow using the seed tooling rather than an upload
    UI in this cut — see KNOWN_LIMITATIONS.md.

16. **Working name "GymFlow"** lives only in `packages/config` and tenant
    branding tables; renaming is a one-file change plus store metadata.
