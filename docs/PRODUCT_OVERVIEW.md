# Product Overview

## What GymFlow is

A multi-tenant gym management platform for Indian gyms, designed to be run
first by a single gym in a rural/semi-urban Andhra Pradesh district and then
commercialized to more gyms and chains **without rewriting the core**.

It replaces notebooks, paper membership cards, hand-calculated expiry dates,
handwritten cash receipts and informal WhatsApp follow-ups.

## Who uses it

| User           | Surface        | What they do                                            |
| -------------- | -------------- | ------------------------------------------------------- |
| Gym owner      | Admin PWA      | Everything, incl. settings, staff, refunds, reports     |
| Branch manager | Admin PWA      | Day-to-day operations + freezes, discount approval      |
| Receptionist   | Admin PWA      | Onboarding, sales, renewals, payments, check-ins, leads |
| Accountant     | Admin PWA      | Payments, refunds, financial reports, audit             |
| Trainer        | Admin PWA      | Members, attendance, PT sessions                        |
| Member         | Mobile app     | Status, QR pass, receipts, attendance, PT, offers       |
| Platform admin | (API/DB today) | Creates tenants, manages platform                       |

## Member lifecycle handled

Lead → Trial/Enquiry → Onboarding → Membership → Attendance → Payments →
Renewal → Freeze → Reactivation → Expiry → Win-back.

Member status (the person) and membership state (each sold period) are
separate models. Membership history is immutable: renewals create new rows,
plan changes create new plan _versions_, and financial records are
append-only at the database level.

## MVP feature inventory (implemented)

**Admin:** email+password auth with throttling and revocable sessions ·
role-based access control (granular permissions, custom roles possible) ·
operational dashboard with expiry queues and collections · member search
(name/mobile/number, trigram-indexed) · guided 2-step onboarding with
duplicate detection · configurable membership plans with versioned commercial
terms · sale/renewal with promotions, quotes, joining-fee logic and immediate
payment+receipt · freeze/unfreeze with automatic expiry extension ·
manual payments (cash/UPI/card/bank) with concurrency-safe receipt numbering
(`SVF-2026-000123`) and printable receipts · refunds (permission-gated,
append-only) · attendance check-in with duplicate guard and QR pass
verification · WhatsApp renewal deep links with tenant-editable EN/TE
templates · leads with statuses, follow-ups and one-tap conversion ·
promotions (percent/flat/joining-fee-waiver, validity, audience, limits,
performance) · reports (collections by method/day, plan mix) + audited CSV
exports · gym settings · append-only audit log · English/Telugu throughout.

**Member app:** tenant-scoped login · home with branding, membership status,
days remaining and a 60-second rotating QR pass · receipts · attendance ·
PT packages/sessions · offers · profile with language switch · offline cache
with explicit stale-data banner.

**Platform:** tenants/brands/branches hierarchy, feature flags,
subscription-tier field, platform-admin role — the commercial controls land
in Phase 2+ but the data model and RLS support them today.

## What is intentionally _not_ in the MVP

Online payments (provider abstraction designed, not wired), SMS/OTP,
push notifications, class scheduling UI, merchandise, SaaS billing,
tenant-admin UI for platform admins. See `docs/ROADMAP.md`.
