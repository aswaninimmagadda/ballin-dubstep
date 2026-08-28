# Privacy

## Design position

Privacy-by-default, aligned with India's DPDP Act 2023 direction:
minimal collection, purpose-limited use, member access to their own data,
retention rules that respect financial-record obligations.

## What we collect, and why

| Data                                    | Purpose                                          | Notes                                                                     |
| --------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------- |
| Name, mobile                            | Identify the member, renewals contact            | Required                                                                  |
| Alt mobile, email, address, village/PIN | Contact & locality reporting                     | Optional                                                                  |
| Gender, date of birth                   | Optional; plan eligibility (student/women plans) | Optional, never required                                                  |
| Emergency contact                       | Safety                                           | Optional                                                                  |
| Photo                                   | Front-desk identification                        | Deferred feature; column exists, no collection yet                        |
| Memberships, payments, receipts         | The service itself + legal records               | Required                                                                  |
| Attendance                              | Access control, member's own history             | Required when feature on                                                  |
| Health data                             | **Not collected** in MVP                         | A future optional injury-note is permission-gated (`members.health.view`) |

No analytics/tracking SDKs in either app. No data is sold or shared across
tenants — isolation is enforced at the database layer.

## Member rights (how the platform supports them)

- **Access/portability:** members see their profile, memberships, payments,
  attendance in the app; tenant-authorized CSV export covers the rest.
- **Correction:** reception edits profile data on request (audited).
- **Deletion/anonymization:** `members.archived_at` removes the member from
  operation; a documented anonymization pass (null out contact fields,
  keep financial rows keyed to the opaque UUID) satisfies deletion requests
  **without destroying legally-retained payment records**. Financial and
  audit records are never deleted on profile removal.

## Deletion in practice (implemented)

A member deletes their account from the app (Overview → Delete my account) or
by asking reception. Immediately: the login, its credentials and roles, every
session and refresh token, and the `users` row are deleted, and the member is
unlinked from the login. A row is written to `member_deletion_requests` so the
gym sees an open request on the member's page and can erase the personal
details it no longer needs. Financial records (payments, receipts, refunds)
are append-only and are retained for the statutory period — the app says so
before the member confirms, and `/account-deletion` states it publicly.

## Retention defaults (tenant-adjustable policy, documented not hard-coded)

- Financial records (payments/receipts/refunds): retain ≥ 8 years
  (Indian records practice).
- Attendance: 24 months rolling.
- Leads that never joined: 12 months.
- Login attempt logs: 7 days (auto-prunable via `app.prune_login_attempts`).

## Security of personal data

See docs/SECURITY.md: RLS isolation, sealed credentials, hashed tokens,
masked phone numbers in lists/logs/audit, no PII in QR codes, no PII in
error messages, HTTPS-only cookies.

## Privacy policy template (for the gym to publish)

> **[Gym name] Privacy Policy** — We collect your name, mobile number and
> the optional details you give us to manage your membership, record your
> payments and let you check in. Your payment history is kept as required
> for financial records. We message you about your membership (expiry,
> receipts, offers) on the number you gave us; tell us if you don't want
> offer messages. We don't sell your information or share it with anyone
> except the software provider that stores it securely on our behalf. You
> can see your information in the member app, ask us to correct it, export
> it, or ask us to remove your profile (payment records we must keep are
> kept without your contact details). Contact: [phone / email].

Telugu translation should be published alongside; the i18n resource file is
the starting point for terminology.
