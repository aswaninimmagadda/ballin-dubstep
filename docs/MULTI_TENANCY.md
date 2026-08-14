# Multi-Tenancy

Tenant isolation is a **release-blocking security requirement**. It is
enforced in the database, not in UI filtering or application WHERE clauses.

## Model

```
Platform → Tenant (gym organization) → Brand → Branch → Staff/Trainers/Members
```

A small gym is one tenant/one brand/one branch; a chain is one tenant with
many branches (brands allow sub-branding later). Every business row carries
`tenant_id`; branch-scoped rows also carry `branch_id`.

## Enforcement layers

1. **Connection role.** The app connects as `gymflow_app` — not the table
   owner, not superuser — so every statement passes through RLS.
2. **Per-transaction claims.** `withClaims(pool, {sub, tenant_id, kind}, fn)`
   sets `request.jwt.claims` transaction-locally (`set_config(..., true)`),
   so pooled connections can never leak identity between requests.
3. **Policies re-verify the claims against data.** `app.is_active_staff()`
   checks that the claimed user actually is an active staff row _of the
   claimed tenant_; a member claiming `kind: staff` or a staff member
   claiming another `tenant_id` gets nothing. Permissions are looked up
   live (`app.has_permission`), so revocation is immediate.
4. **WITH CHECK on writes.** Inserting a row stamped with another tenant's
   id raises an RLS violation even if the caller "knows" the foreign UUIDs.
5. **Sequences and settings are tenant-scoped too** — receipt numbers and
   membership numbers allocate inside authorization-checked SECURITY DEFINER
   functions.

## Member self-access

Member claims (`kind: member`) resolve to their own member row via
`app.current_member_id()`. Policies grant SELECT only on: their member row,
their memberships/freezes/add-ons/sessions/payments/receipts/attendance/
notifications, active plans and active promotions of their tenant, and the
`trainer_public` view (no trainer mobile numbers). Members have **no** write
policies.

## Proven by tests

`packages/database/test/tenant-isolation.test.ts` runs as the real runtime
role and asserts, among others:

- Tenant A staff see zero tenant-B rows in every business table.
- Fetch/update of a tenant-B row by exact UUID: 0 rows.
- INSERT stamped with tenant B: RLS violation.
- No claims → no rows. Forged kind/tenant claims → no rows.
- Members see exactly themselves; cannot write anything.
- Platform admin (real row required) sees all tenants.

The final acceptance requirement — “create a second gym and prove Gym A
staff cannot see Gym B” — is executed by these tests on every CI run: the
fixture builds two fully-populated tenants and attacks the boundary from
both sides.

## Adding a new tenant-owned table

1. Add `tenant_id uuid NOT NULL REFERENCES tenants(id)` + index.
2. Add it to the RLS enable list and the staff policy map in a new
   migration (see 0003 for the pattern), choosing view/insert/update
   permissions.
3. Add it to the isolation test's `TABLES` list.
   Skipping step 2 fails closed: RLS enabled with no policy = no access.
