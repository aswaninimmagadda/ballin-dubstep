# Known Limitations

Honest list, in rough order of operational impact. None are silent — each
has a workaround or a Phase-2 slot (see ROADMAP.md).

## Product

1. **No platform-admin UI.** Creating a tenant/branches/first owner is a
   documented SQL/script runbook executed by the operator. Isolation and
   roles are fully enforced; only the convenience UI is missing.
2. **No self-serve password reset.** Staff resets go through the owner
   (`app.auth_set_password` + revoke-all-sessions); member resets happen at
   reception. Email/SMS reset needs a provider (Phase 2).
3. **No online payments** — manual cash/UPI-reference recording only. The
   provider abstraction and webhook-idempotency pattern are designed but not
   wired.
4. **Notifications are pull + WhatsApp deep links.** The engine tables and
   dedupe design exist; no background senders yet (expiry reminders are the
   dashboard queue + one-tap WhatsApp).
5. **CSV import has schema + validation but no upload UI.** Migration from
   notebooks is operator-assisted this cut.
6. **Member app has no in-app renewal/booking** — it is read-only by design
   for the MVP (renewals happen at the desk).
7. **PT scheduling is minimal:** packages, sessions, double-booking guard —
   no calendar UI, recurrence or class capacity yet.
8. **Reports are the operational core set** (collections, plan mix,
   exports); owner analytics (churn/renewal-rate trends with defined
   denominators) are Phase 2 with definitions to be documented alongside.
9. **Bulk operations** limited to CSV export + WhatsApp-per-member; no bulk
   messaging/tagging UI yet.
10. **Branch scoping is enforced but not surfaced** — staff_branch_access
    works at the policy level; the admin UI doesn't yet manage it.

## Technical

11. **Login throttling is DB-backed per identifier/IP** — robust for the
    pilot; a busy multi-instance deployment should add an edge rate limiter.
12. **Admin PWA is online-first.** The manifest enables installation; a
    service worker with an offline shell/queue is Phase 2 hardening. No
    silent data loss exists (server-authoritative writes fail visibly).
13. **Overlapping freeze+pending-renewal edge:** extending a frozen
    membership can push its end past a pre-sold renewal's start; the system
    keeps both visible and staff resolve by adjusting the renewal start
    (an `memberships.override` action). Rare in practice; a guided
    resolution flow is a Phase-2 nicety.
14. **Trainer deletion is deactivation.** FKs restrict hard deletes when
    sessions exist — intended, but the UI only offers active/inactive.
15. **E2E suite drives HTTP + DB, not a real browser.** Server-rendered
    forms make this high-fidelity, but a Playwright layer would also catch
    client-side regressions (Phase 2; Playwright is pre-installed in the
    dev environment).
16. **Supabase free-tier project pausing** would take the pilot down after
    inactivity — see DEPLOYMENT.md for the mitigation before going live.
17. **Member-app API base URL is app.json config** — fine for one shared
    backend; per-tenant custom domains would need a config service.
