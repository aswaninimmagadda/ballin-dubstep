# Database Schema

Authoritative source: `supabase/migrations/*.sql` (applied in filename
order; tracked in `schema_migrations`). This document is the map.

## Entity-relationship overview

```
tenants ─┬─ brands ─── branches ─┬─ members ─┬─ memberships ─── membership_events
         │                       │           │      │        └─ membership_freezes
         │                       │           │      └─ payment_allocations ─ payments ─┬─ receipts
         │                       │           │                                         └─ refunds
         │                       │           ├─ member_addons ── trainer_sessions
         │                       │           ├─ attendance
         │                       │           ├─ member_status_history
         │                       │           └─ promotion_redemptions ─ promotions
         │                       ├─ trainers
         │                       └─ leads ── lead_activities
         ├─ membership_plans ─── membership_plan_versions
         ├─ addon_packages
         ├─ gym_settings (1:1)      ├─ receipt_sequences
         ├─ feature_flags           └─ audit_logs
         └─ users ─┬─ user_credentials     roles ─ role_permissions
                   ├─ sessions             user_roles
                   ├─ refresh_tokens       staff_branch_access
                   └─ (login_attempts by identifier)
```

## Table groups

### Tenancy

- **tenants** — slug, status (`trial/active/suspended/archived`),
  subscription tier, locale defaults.
- **brands** — logo, colors, support contacts, terms/privacy URLs
  (white-label readiness).
- **branches** — per-branch address/timezone; unique `(tenant_id, code)`.

### Identity & RBAC

- **users** — `kind` platform_admin | staff | member. Staff email unique
  globally; member phone unique **per tenant** (same person, two gyms — OK).
- **user_credentials / sessions / refresh_tokens / login_attempts** — sealed
  behind SECURITY DEFINER functions; the app role has zero direct grants.
- **roles / role_permissions / user_roles** — permissions are strings like
  `payments.refund`; system roles are seeded rows, custom roles are just
  more rows. **staff_branch_access** restricts staff to branches (no rows =
  all branches).

### Members & memberships

- **members** — profile, contact, emergency contact, join data, status
  (person-level), tags; trigram index on name, unique `(tenant, mobile)`.
- **memberships** — one row per sold period. Snapshots plan name + terms
  reference (`plan_version_id`), start/base_end/end dates, state
  (`pending/active/frozen/cancelled/expired`), totals in paise, promotion,
  renewal chain, idempotency key. Partial unique indexes: at most one
  running (`active/frozen`) and one `pending` per member.
- **membership_events** — sold/renewed/frozen/… event stream.
- **membership_freezes** — one open freeze max; extension days recorded on
  close.
- **membership_plans / membership_plan_versions** — pricing/terms are
  versioned; selling always references a version. Changing price = new
  version; history never rewrites.
- **addon_packages / member_addons** — PT and other add-ons with session
  counting and validity; snapshots of name/price at purchase.
- **trainers / trainer_sessions** — trainer profiles (member-visible subset
  via the `trainer_public` view — no personal mobile), sessions with a
  partial unique index preventing double-booking.

### Money (append-only)

- **payments** — immutable; only `status` may transition to refund states
  (trigger-enforced). Idempotency key unique per tenant.
- **payment_allocations** — links payments to memberships/add-ons.
- **refunds** — reason, approver; insert-only.
- **receipts / receipt_sequences** — `app.next_receipt_seq(tenant, fy)`
  allocates under a row lock; number format
  `{prefix}-{fiscalYear}-{seq padded}`; fiscal year = Indian FY (Apr–Mar).

### Operations

- **attendance** — branch, method (`reception/qr/manual`), timestamps.
- **leads / lead_activities** — lightweight CRM.
- **promotions / promotion_redemptions** — engine described in core.
- **notification_templates / notification_deliveries** — per-tenant, per
  language templates; deliveries carry a unique dedupe key (no double
  sends). Send workers are Phase 2.
- **gym_settings** — structured per-tenant configuration (receipt prefix,
  reminder days, freeze rules, WhatsApp templates EN/TE, …) + `extra` jsonb
  for genuinely dynamic keys only.
- **feature_flags** — tenant × flag.
- **audit_logs** — actor, action, entity, redacted before/after; insert-only
  even for owners.

## Conventions

- UUID PKs (`gen_random_uuid()`); `bigint` money (paise); `date` for
  calendar dates; `timestamptz` for instants; `text + CHECK` enums.
- Every tenant-owned table carries `tenant_id` with an FK — policies always
  compare it to the claims, so a permission never crosses tenants.
- `updated_at` maintained by trigger.
- Soft delete only where justified (`members.archived_at`); financial rows
  are never deleted.

## Migrations

| File                            | Contents                                                              |
| ------------------------------- | --------------------------------------------------------------------- |
| 0001_initial_schema.sql         | All tables, constraints, indexes, app role                            |
| 0002_functions_triggers.sql     | Claim helpers, touch triggers, append-only guards, allocators, grants |
| 0003_rls.sql                    | Enable RLS + all policies + `trainer_public` view                     |
| 0004_auth_functions.sql         | Sealed auth path (lookup/session/refresh/throttle)                    |
| 0005_member_lookup.sql          | Member-by-user definer lookup (token refresh)                         |
| 0006_membership_live_states.sql | Split live-state uniqueness (early renewal)                           |

Reset/seed: `pnpm db:reset && pnpm db:seed` (never against production).
