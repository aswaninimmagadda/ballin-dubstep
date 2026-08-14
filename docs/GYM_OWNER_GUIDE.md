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

## Appendix: platform operator runbook (creating a new gym)

Until the platform-admin UI ships, a new tenant is created by the platform
operator (not gym staff) with the seed pattern — no code changes:

```sql
-- as the DB owner
INSERT INTO tenants (slug, name, status) VALUES ('newgym', 'New Gym', 'active');
INSERT INTO brands (tenant_id, name) SELECT id, 'New Gym' FROM tenants WHERE slug='newgym';
INSERT INTO branches (tenant_id, brand_id, name, code)
  SELECT t.id, b.id, 'Main', 'MAIN' FROM tenants t JOIN brands b ON b.tenant_id = t.id
  WHERE t.slug='newgym';
INSERT INTO gym_settings (tenant_id, receipt_prefix)
  SELECT id, 'NGM' FROM tenants WHERE slug='newgym';
-- roles: copy the block from packages/database/scripts/seed.ts (SYSTEM_ROLE_PERMISSIONS)
-- first owner: INSERT INTO users(kind:'staff', …) + app.auth_set_password via a one-off script
```

`packages/database/scripts/seed.ts` is the executable reference for the
full sequence (roles + permissions + owner). After this, everything —
branches, plans, staff, promotions, templates — is configured by the gym
owner in the UI. That satisfies the "new gym without source changes"
acceptance criterion; the SQL itself becomes a UI in Phase 2.
