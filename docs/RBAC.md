# Role-Based Access Control

Permissions are granular strings checked centrally — never role-name
comparisons scattered in UI code. The catalog lives in
`packages/types/src/rbac.ts`; default role → permission sets in
`packages/core/src/rbac.ts` (seeded as **rows**, so tenants can define
custom roles without code changes).

## Permission catalog

`members.view/create/edit/delete/export/merge`, `members.health.view`,
`memberships.sell/renew/freeze/cancel/override`, `plans.view/manage`,
`payments.view/record/refund`, `discounts.apply/approve`,
`promotions.view/manage`, `leads.view/manage`, `attendance.view/checkin`,
`trainers.view/manage`, `pt.view/manage`, `reports.view/financial/export`,
`staff.view/manage`, `settings.view/manage`, `audit.view`, `import.run`,
`notifications.manage`.

## Default role matrix (seeded)

| Permission group                   | Owner | Manager | Receptionist | Trainer | Accountant |
| ---------------------------------- | :---: | :-----: | :----------: | :-----: | :--------: |
| members view/create/edit           |   ✓   |    ✓    |      ✓       |  view   |    view    |
| members delete/merge/export        |   ✓   | export  |      —       |    —    |     —      |
| memberships sell/renew             |   ✓   |    ✓    |      ✓       |    —    |     —      |
| memberships freeze/cancel/override |   ✓   |    ✓    |      —       |    —    |     —      |
| plans manage                       |   ✓   |    ✓    |     view     |    —    |    view    |
| payments record                    |   ✓   |    ✓    |      ✓       |    —    |     ✓      |
| payments refund                    |   ✓   |    —    |      —       |    —    |     ✓      |
| discounts apply / approve          |  ✓/✓  |   ✓/✓   |     ✓/—      |    —    |     —      |
| promotions manage                  |   ✓   |    ✓    |     view     |    —    |     —      |
| leads manage                       |   ✓   |    ✓    |      ✓       |    —    |     —      |
| attendance check-in                |   ✓   |    ✓    |      ✓       |    ✓    |     —      |
| trainers/PT manage                 |   ✓   |    ✓    |     view     |  PT ✓   |     —      |
| reports view / financial           |  ✓/✓  |   ✓/—   |      —       |    —    |    ✓/✓     |
| reports export                     |   ✓   |    ✓    |      —       |    —    |     ✓      |
| staff manage                       |   ✓   |  view   |      —       |    —    |     —      |
| settings manage                    |   ✓   |  view   |      —       |    —    |     —      |
| audit view                         |   ✓   |    ✓    |      —       |    —    |     ✓      |
| import run                         |   ✓   |    ✓    |      —       |    —    |     —      |

Members hold the `member` role (no staff permissions); their access is the
self-scope described in `MULTI_TENANCY.md`. The platform admin is a separate
user kind with platform-wide policies.

## Where checks happen

1. **Database (authoritative):** every RLS write policy requires the
   relevant permission via `app.has_permission()` in addition to tenant
   match. A receptionist INSERTing into `refunds` is rejected by Postgres
   itself (tested in `permissions.test.ts`).
2. **Server (UX + defense in depth):** pages/actions call
   `requirePermission('…')`, which redirects to `/forbidden`; API routes
   return 403. UI hides actions the user can't take, but hiding is never
   the control.
3. **Revocation:** deactivating a user kills access instantly (policies
   check `is_active`; sessions can be bulk-revoked via
   `app.sessions_revoke_all`).

## Custom roles

Insert a `roles` row for the tenant + `role_permissions` rows, then assign
via `user_roles`. No deployment needed. (Admin UI for this is Phase 2; the
data model and policies already support it.)
