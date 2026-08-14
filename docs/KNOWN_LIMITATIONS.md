# Known Limitations

Honest list, in rough order of operational impact. None are silent — each
has a workaround or a Phase-2 slot (see ROADMAP.md).

## Product

1. **Platform-admin tenant creation is a CLI, not a web console.** A new gym
   is provisioned in one command (`pnpm --filter @gymflow/database
create-tenant -- --slug … --name … --owner-email …`) with zero source
   changes — proven by the automated acceptance test — but a browser UI for
   platform operators is Phase 2.
2. **No self-serve password reset.** Staff resets happen on the Staff page
   (owner clicks "Reset password", gets a one-time password, sessions are
   revoked); member resets happen at reception via "Enable member app
   access" (re-issues credentials). Email/SMS self-service needs a provider
   (Phase 2). One-time passwords render once in the POST response
   (`/credentials`, no-store) — they never appear in URLs or logs.
   The `create-tenant` CLI's optional `--owner-password` flag does put a
   password in shell history; omit it and let the CLI generate one (the
   default), as the runbook instructs.
3. **No online payments** — manual cash/UPI-reference recording only. The
   provider abstraction and webhook-idempotency pattern are designed but not
   wired.
4. **Notification channels are in-app + WhatsApp deep links only.**
   Payment/renewal events now write real in-app notifications (deduped,
   visible in the member app); push/SMS/WhatsApp-API senders over the same
   tables are Phase 2. Expiry reminders remain the dashboard queue + one-tap
   WhatsApp.
5. **Member app is read-only by design** — no in-app renewal/booking in the
   MVP (renewals happen at the desk).
6. **PT scheduling is minimal:** packages, one-tap session logging from the
   member page (auto-completes the package on the last session), and a
   double-booking guard — no calendar UI, recurrence or class capacity yet.
   No-show marking is supported by the service layer but has no dedicated
   button.
7. **Reports are the operational core set** (collections, plan mix,
   exports); owner analytics (churn/renewal-rate trends with defined
   denominators) are Phase 2 with definitions to be documented alongside.
8. **Bulk operations** are limited to CSV import/export + per-member
   WhatsApp; no bulk messaging/tagging UI yet.
9. **Branch scoping is enforced but not surfaced** — staff_branch_access
   works at the policy level; the admin UI doesn't yet manage it.
10. **CSV import targets the first active branch** and creates one
    membership per row; multi-branch imports are done per-branch (or rows
    edited afterwards). Trainer-name column is accepted but not yet linked.

## Technical

11. **Login throttling is DB-backed per identifier/IP** — robust for the
    pilot; a busy multi-instance deployment should add an edge rate limiter.
12. **Admin PWA is online-first by design.** The service worker caches only
    static assets and shows an offline fallback page + live offline banner;
    business pages/data are never served stale, and no writes are queued
    offline (server-authoritative, fails visibly).
13. **Overlapping freeze+pending-renewal edge:** extending a frozen
    membership can push its end past a pre-sold renewal's start; the system
    keeps both visible and staff resolve by adjusting the renewal (an
    `memberships.override` action). Rare in practice; a guided resolution
    flow is a Phase-2 nicety.
14. **Trainer deletion is deactivation.** FKs restrict hard deletes when
    sessions exist — intended; the Trainers page offers activate/deactivate.
15. **E2E suites drive HTTP + DB, not a pixel-level browser.** The
    server-rendered forms make this high-fidelity; a Playwright layer would
    additionally catch client-side regressions (Phase 2).
16. **Supabase free-tier project pausing** would take the pilot down after
    inactivity — see DEPLOYMENT.md for the mitigation before go-live.
17. **Member-app API base URL is app.json config** — fine for one shared
    backend; per-tenant custom domains would need a config service.
18. **Stored membership states are trued up by a daily sweep** (`pnpm
--filter @gymflow/database sweep`, cron — see DEPLOYMENT.md). Every
    read path derives live status from dates (so screens, the check-in
    gate and the member app are correct between sweeps); the sweep keeps
    the _stored_ `state`/`status` columns — used by list filters and
    reports — in step: pending→active on the start date, active→expired
    after the grace window. If the cron is missed, nothing breaks; stored
    states lag until the next run.
