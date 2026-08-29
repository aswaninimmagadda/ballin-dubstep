# Known Limitations

Honest list, in rough order of operational impact. None are silent — each
has a workaround or a Phase-2 slot (see ROADMAP.md).

## Product

1. **Platform-admin tenant creation is a CLI, not a web console.** A new gym
   is provisioned in one command (`pnpm --filter @gymflow/database
create-tenant -- --slug … --name … --owner-email …`) with zero source
   changes — the acceptance test runs that exact command — but a browser UI
   for platform operators is Phase 2.
2. **Password changes yes, forgotten-password resets no.** Signed-in staff
   and owners rotate their own password at `/account/password` (verifies the
   current one, then signs every session out). A _forgotten_ password still
   needs someone else: the owner reissues on the Staff page, and reception
   reissues member logins via "Enable member app access". Self-service reset
   needs an email/SMS provider (Phase 2). One-time passwords render once in
   the POST response (`/credentials`, no-store) — never in URLs or logs. The
   `create-tenant` CLI's optional `--owner-password` flag does put a password
   in shell history; omit it and let the CLI generate one, as the runbook says.
3. **No online payments** — manual cash/UPI-reference recording only. The
   provider abstraction and webhook-idempotency pattern are designed but not
   wired.
4. **Notification channels are in-app + WhatsApp deep links only.**
   Payment/renewal events write real in-app notifications (deduped, visible in
   the member app); push/SMS/WhatsApp-API senders over the same tables are
   Phase 2. Expiry reminders remain the dashboard queue + one-tap WhatsApp.
5. **Member app is read-only by design** — no in-app renewal/booking in the
   MVP (renewals happen at the desk).
6. **PT scheduling is minimal:** packages, one-tap session logging from the
   member page (auto-completes the package on the last session), and a
   double-booking guard — no calendar UI, recurrence or class capacity yet.
   No-show marking is supported by the service layer but has no button.
7. **Reports are the operational core set** (collections net of refunds, plan
   mix, dues, exports); owner analytics (churn/renewal-rate trends with
   defined denominators) are Phase 2.
8. **Bulk operations** are limited to CSV import/export + per-member
   WhatsApp; no bulk messaging/tagging UI yet.
9. **Plan pricing cannot be edited in place.** `updatePlanTerms` exists in the
   service layer but has no UI. To change a price, create a new plan and
   deactivate the old one — sold memberships keep the versioned price they
   were sold at either way, so history stays correct. Wiring the edit form is
   a small Phase-2 item.
10. **Promotion usage limits are engine-enforced but not form-settable.** The
    eligibility engine honours total and per-member redemption limits and the
    schema stores them, but the promotions form doesn't expose the two fields
    yet — promotions created in the UI are unlimited until a limit is set in
    the database.
11. **Collections-by-day is computed but not displayed.** The reports service
    returns a per-day series; the page renders the total, the by-method split
    and the plan mix only. The payments CSV carries per-payment dates, so the
    data is reachable today.
12. **The sale screen shows plan prices, not a live promo-adjusted total.**
    Staff see each plan's price and joining fee, but a promotion's effect is
    computed on submit. If the amount entered is wrong the error names the
    exact figure to collect, so it self-corrects in one step.
13. **Branch scoping is enforced but not surfaced** — staff_branch_access
    works at the policy level; the admin UI doesn't yet manage it.
14. **CSV import targets the first active branch** and creates one membership
    per row; multi-branch imports are done per-branch (or rows edited
    afterwards). Trainer-name column is accepted but not yet linked.
15. **One member per mobile number per gym** (`members_tenant_mobile_unique`).
    Families sharing a handset must register the second person under their own
    number; the duplicate check surfaces the existing member so staff see why.
    The constraint is what prevents accidental double-entry — a deliberate
    trade-off to revisit if the pilot shows shared numbers are common.
16. **Navigation and action buttons are not permission-filtered.** Server-side
    authorization is real — following a link you shouldn't have gives the "no
    permission" page — but the link is still shown. Cosmetic, and in the safe
    direction: enforcement never depends on hiding.
17. **Confirmation and error text is English-only.** Labels, navigation,
    form fields, hints, placeholders and the member app are bilingual —
    en/te parity is enforced by a test, and `scripts/check-i18n-coverage.mjs`
    (run in CI) fails the build if a user-visible string is hard-coded in a
    page instead of going through the translations. That second check exists
    because the parity test cannot see a string that never reached a resource
    file, which is how 65 labels and hints stayed English through an earlier
    release that claimed full coverage.

    What remains English: banner messages raised from server actions
    ("Payment recorded.", "Member archived.") and the UserFacingError strings
    behind them, which are literals in the service layer. A Telugu-speaking
    receptionist gets Telugu screens with English confirmations.

## Technical

18. **Login throttling is DB-backed**, counted separately per identifier (8 in
    15 minutes) and per IP (60, so a shared gym address cannot lock everyone
    out). A busy multi-instance deployment should still add an edge limiter.
19. **Admin PWA is online-first by design.** The service worker caches only
    static assets and shows an offline fallback page + live offline banner;
    business pages/data are never served stale, and no writes are queued
    offline (server-authoritative, fails visibly).
20. **Overlapping freeze+pending-renewal edge:** extending a frozen membership
    can push its end past a pre-sold renewal's start; the system keeps both
    visible and staff resolve by adjusting the renewal (a
    `memberships.override` action). A guided resolution flow is a Phase-2
    nicety.
21. **Trainer deletion is deactivation.** FKs restrict hard deletes when
    sessions exist — intended; the Trainers page offers activate/deactivate.
22. **E2E suites drive HTTP + DB, not a pixel-level browser.** The
    server-rendered forms make this high-fidelity; a Playwright layer would
    additionally catch client-side regressions (Phase 2).
23. **The member app has not been run on physical Android hardware here.** Its
    JS bundle builds in CI (Metro export) and every screen was exercised
    against the live API through Expo's web renderer, but no APK/AAB has been
    produced and no device or emulator run has happened — that is the first
    thing to do in pilot testing (see the Install & Test Guide).
24. **Supabase free-tier project pausing** would take the pilot down after
    inactivity — see DEPLOYMENT.md for the mitigation before go-live.
25. **Member-app API base URL is a build-time setting** (`GYMFLOW_API_URL`,
    baked in by `app.config.js`) — fine for one shared backend; per-tenant
    custom domains would need a config service or an in-app server field.
26. **Stored membership states are trued up by a daily sweep** (`pnpm --filter
@gymflow/database sweep`, cron — see DEPLOYMENT.md). Every read path derives
    live status from dates (so screens, the check-in gate and the member app
    are correct between sweeps); the sweep keeps the _stored_ `state`/`status`
    columns — used by list filters and reports — in step: pending→active on
    the start date, active→expired after the grace window. If the cron is
    missed nothing breaks; stored states lag until the next run.
