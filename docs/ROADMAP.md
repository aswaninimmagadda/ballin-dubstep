# Roadmap

## Phase 1 — shipped in this repository

Multi-tenant core with RLS · staff auth + RBAC · dashboard/expiry queues ·
onboarding with duplicate detection · versioned plans · sales/renewals/
freezes with centralized date+pricing engine · manual payments, atomic
receipts, refunds · attendance with QR pass · WhatsApp renewal deep links
(EN/TE) · leads · promotions · reports + CSV export · audit log · member
app (status/QR/receipts/attendance/PT/offers, offline-aware) · seed/demo
tenant · CI with release-blocking isolation tests · full docs.

## Phase 2 — commercialization enablers (priority order)

1. **Platform-admin console** — tenant CRUD, suspend, feature flags, trial
   management (replaces the SQL runbook; policies already exist).
2. **Notification workers** — expiry reminders/receipts over the existing
   template+dedupe tables; channels: in-app + push (Expo Notifications),
   optional SMS provider with DLT registration.
3. **Online payments** — `PaymentProvider` interface (createIntent/verify/
   webhook/refund/status) with Razorpay first; server-verified webhooks,
   idempotent event store; UPI renewal from the member app.
4. **Self-serve password reset** (email/SMS OTP) + optional staff MFA
   (TOTP).
5. **CSV import UI** — upload → validate (schema exists) → preview → dry
   run → confirm; duplicate handling; per-row error report.
6. **Owner analytics** — renewal rate, churn (with documented
   denominator/period), revenue trend, attendance trend, trainer
   utilization, plan-mix over time.
7. **Playwright browser E2E** on top of the HTTP suite; offline service
   worker for the admin PWA.
8. **Branch-access management UI**, custom-role editor, staff invitations.
9. **Member photos/documents** — signed URLs, tenant-isolated storage
   paths, MIME/size validation.
10. **Class/PT calendar** — trainer schedules, capacity, member booking.

## Phase 3 — expansion (build only when pulled by customers)

Merchandise/inventory · SaaS subscription billing with entitlement
enforcement (tier field + flags already gate) · franchise/chain reporting
roll-ups · automated win-back campaigns · turnstile/biometric device
integration · body-composition integrations · workout/nutrition content ·
AI insights on retention.

## Deliberate non-goals

Per-gym app forks · storing card numbers (gateway tokens only, when
payments land) · impersonation without an audited design · one database per
customer.
