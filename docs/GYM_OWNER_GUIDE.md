# Gym Owner Guide

Everything in the staff guide applies to you, plus:

## Plans (Plans page)

Create plans without any developer: name, duration (months/days), price,
joining fee, grace days, freeze allowance, optional timing window (e.g. a
women's-morning plan 05:30–10:30). **Price changes create a new version** —
members who bought at the old price keep their terms forever; deactivating
a plan hides it from sale without touching existing memberships.

## Promotions

Create offers with a code (SANKRANTI27), percentage/flat/joining-fee-waiver,
validity dates and audience (everyone / new members / renewals / win-back).
The list shows uses and total ₹ discounted. Staff apply codes at
sale/renewal; ineligible codes are refused with the reason.

## Settings

Receipt prefix, grace period, freeze caps, partial payments on/off, the
WhatsApp renewal message in English and Telugu (placeholders:
`{{member_first_name}}`, `{{gym_name}}`, `{{expiry_date}}`), receipt footer.
Changes apply immediately; every change is in the activity log.

## Staff & roles

Default roles: Owner, Branch Manager, Receptionist, Trainer, Accountant —
see docs/RBAC.md for exactly who can do what (short version: receptionists
sell and collect but can't refund, change settings or read the audit log;
accountants handle money and reports; managers everything operational).
Deactivating a staff member cuts their access instantly, including open
sessions.

## Money safety (why it works this way)

- Payments and receipts can never be edited or deleted — by anyone,
  including you. Corrections are refunds, which record who approved them.
- Receipt numbers are sequential per financial year and cannot collide even
  with two receptionists billing simultaneously.
- The **Activity log** shows every sensitive action (who, what, when) and
  cannot be erased.

## Reports

Collections by day and by method (cash vs UPI — reconcile the cash drawer
daily), plan mix, and CSV exports of members/memberships/payments/attendance
that open in Excel/Sheets. **Your data is exportable at any time — you are
never locked in.** Exports are permission-gated and logged.

## Your data & member privacy

Collect only what you need (the forms already default that way). Don't put
medical details in notes. The privacy-policy template in docs/PRIVACY.md is
written to match what the system actually stores — put your gym name in and
publish it.

---

## Appendix: platform operator — creating a new gym

A new tenant is provisioned in one command by the platform operator (never
gym staff), with zero source-code changes:

```bash
DATABASE_URL=<owner-url> pnpm --filter @gymflow/database create-tenant -- \
  --slug harshafit --name "Harsha Fitness" \
  --owner-email owner@harshafit.in --receipt-prefix HFT \
  --branch "Main/MAIN"
```

It creates the tenant, brand, branch, settings, all system roles with
permissions, and the owner account, then prints the owner's one-time
password once. From there the owner configures everything in the UI: staff
accounts (Staff page), plans and PT packages (Plans), trainers, promotions,
templates and settings. This exact flow — including a second gym's complete
isolation from the first — is exercised automatically by
`scripts/e2e-acceptance.mjs`.
