# Performance

Numbers here are measured, not estimated. `scripts/perf-probe.mjs` reproduces
every one of them: it builds a 5,000-member tenant, measures the admin app's
hot queries as the restricted runtime role with RLS applied, and rolls the
whole thing back.

```bash
DATABASE_URL=postgres://postgres:…@localhost:5432/gymflow_dev \
  node scripts/perf-probe.mjs
```

`DATABASE_URL` must own the tables and be able to `SET ROLE gymflow_app`. The
probe exits non-zero if any query exceeds `PERF_BUDGET_MS` (default 250 ms), so
it works as a regression gate; `PERF_MEMBERS` changes the fixture size.

## Why a 5,000-member gym is the interesting case

The AP pilot gyms are 300–1,500 members, but a multi-branch chain on one tenant
reaches 5,000 quickly, and that is where an O(rows) cost stops being invisible.
The probe deliberately measures through RLS as `gymflow_app`. Measuring as the
table owner skips every policy and reports numbers no real request can achieve.

## The finding: RLS predicates were the cost, not the scans

Every policy called its helpers directly:

```sql
USING (app.is_active_staff() AND tenant_id = app.current_tenant_id()
       AND app.has_permission('members.view') AND app.branch_allowed(branch_id))
```

`app.is_active_staff()` and `app.has_permission()` are `STABLE SECURITY
DEFINER` functions that each run an `EXISTS` against `users` / `user_roles` /
`role_permissions`. Inside a policy qual PostgreSQL evaluates them **once per
row**. Loading page 1 of the member list meant roughly 20,000 extra index
lookups.

The proof that the scan was never the problem: the same members search took
**409 ms** through RLS and **4.9 ms** as a superuser with policies bypassed —
98.8% of the time was the policy predicate.

The fix (migration `0014_rls_predicate_hoisting.sql`) wraps every call that
does not depend on the row in a scalar subquery:

```sql
USING ((SELECT app.is_active_staff()) AND tenant_id = (SELECT app.current_tenant_id())
       AND (SELECT app.has_permission('members.view')) AND app.branch_allowed(branch_id))
```

The planner turns each one into an InitPlan, evaluated exactly once per query.
This is a planner-level change only: a scalar subquery over a one-row
expression is semantically identical to the expression, NULLs included. The
migration's statements were generated from `pg_policy` and each was verified by
mechanically stripping the wrappers back out and asserting byte-equality with
the predicate it replaced; the migration then re-checks the catalog and aborts
if any policy was left un-hoisted. All 128 policies across 35 tables are
covered, and the 15 release-blocking tenant-isolation tests plus the 4
branch-scoping tests pass unchanged.

`app.branch_allowed(branch_id)` is deliberately **not** hoisted — its argument
is a column, so it cannot become an InitPlan, and wrapping it only adds SubPlan
overhead (measured 28.5 ms vs 24.7 ms).

## The second finding: the member list computed dues for the whole gym

`searchMembers` joined the plan/dues `LATERAL` before applying `LIMIT 25`, so
the dues subquery ran once per member in the tenant to render 25 rows. Paging
the members in a derived table first drops the LATERAL to 25 evaluations.

## Results (5,000 members, RLS on)

| Query                                   | Before  | After  |     |
| --------------------------------------- | ------- | ------ | --- |
| Members list, page 1 (25 rows + dues)   | 1230 ms | 27 ms  | 45x |
| Members count (pagination total)        | 758 ms  | 24 ms  | 32x |
| Members search, name term               | 409 ms  | 28 ms  | 15x |
| Members search, phone digits            | 410 ms  | 28 ms  | 15x |
| Members with dues filter (whole tenant) | 1197 ms | 69 ms  | 17x |
| Expiring-soon queue (next 7 days)       | —       | 0.9 ms |     |
| Month-to-date collections               | —       | 1.4 ms |     |

Both fixes are structural, so they scale: the hoisting removes a per-row cost
entirely, and the pagination fix makes the list query's dues work independent
of gym size.

## What is still linear, and when it will matter

- **Members search** has no index for the `mobile` / `membership_number`
  branches — only names carry a GIN trigram index — so search is a sequential
  scan. At 5,000 members that is 28 ms, which is imperceptible. Past roughly
  50,000 members in one tenant, add trigram indexes on those two columns
  (`gin (mobile gin_trgm_ops)`) and the OR becomes a BitmapOr.
- **The dues filter** evaluates the allocation/refund aggregate for every live
  membership in the tenant (69 ms at 5,000). If a gym leaves the filter on all
  day at much larger scale, materialize a per-membership paid-to-date total.

Neither is a pilot-scale problem, and both are recorded in
`docs/KNOWN_LIMITATIONS.md` rather than pre-optimized.
