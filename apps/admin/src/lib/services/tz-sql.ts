import 'server-only';

/**
 * The tenant's calendar day as a half-open timestamptz range.
 *
 * The obvious way to ask "did this happen today?" is
 *
 *   WHERE (a.checked_in_at AT TIME ZONE t.default_timezone)::date = $1::date
 *
 * which is correct and unindexable: wrapping the column in an expression that
 * also depends on a joined column defeats attendance_tenant_idx entirely, so
 * every dashboard load and every attendance page sequentially scanned the
 * whole table. At a 5,000-member gym with three years of check-ins that is
 * 1.5M rows and seconds per page — on the two screens reception looks at all
 * day.
 *
 * These compare the raw column against two bounds instead. Each bound is a
 * scalar subquery over a single tenant row, which the planner turns into an
 * InitPlan evaluated once, so the comparison is against a constant and the
 * index range scan is available.
 *
 * Half-open on purpose: `>= start AND < next` needs no assumption about the
 * column's precision, and does not double-count an event at midnight.
 *
 * `$n` is the tenant-local date (YYYY-MM-DD). The caller must expose the
 * tenant's timezone through the tenants table, which RLS already scopes.
 */
function tenantDayBound(dateParam: string, offsetDays: number): string {
  const day = offsetDays === 0 ? `${dateParam}::date` : `(${dateParam}::date + ${offsetDays})`;
  return `(SELECT ${day}::timestamp AT TIME ZONE t.default_timezone
             FROM tenants t WHERE t.id = (SELECT app.current_tenant_id()))`;
}

/** `<column>` falls on the tenant's calendar day `$n`. */
export function onTenantDay(column: string, dateParam: string): string {
  return `${column} >= ${tenantDayBound(dateParam, 0)}
      AND ${column} < ${tenantDayBound(dateParam, 1)}`;
}

/** `<column>` falls on or after the tenant's calendar day `$n`. */
export function fromTenantDay(column: string, dateParam: string): string {
  return `${column} >= ${tenantDayBound(dateParam, 0)}`;
}

/** `<column>` falls within the tenant's calendar days `$from`..`$to` inclusive. */
export function betweenTenantDays(column: string, fromParam: string, toParam: string): string {
  return `${column} >= ${tenantDayBound(fromParam, 0)}
      AND ${column} < ${tenantDayBound(toParam, 1)}`;
}
