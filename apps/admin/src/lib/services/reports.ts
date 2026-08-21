import 'server-only';
import { asPrincipal } from '../db';
import { DUE_ON_MEMBERSHIP, LIVE_MEMBERSHIP_STATES, PAID_AGAINST_MEMBERSHIP } from './money-sql';
import type { SessionUser } from '../session';

export interface CollectionsSummary {
  byMethod: { method: string; total: string; count: number }[];
  byDay: { day: string; total: string }[];
  /** Gross receipts before refunds. */
  gross: string;
  /** Refunds paid out in the same window (dated by when the money left). */
  refunds: string;
  /** gross − refunds: the figure that must match the drawer. */
  total: string;
}

export async function collectionsReport(
  user: SessionUser,
  opts: { from: string; to: string; branchId?: string; method?: string },
): Promise<CollectionsSummary> {
  return asPrincipal(user.claims, async (tx) => {
    const params: unknown[] = [opts.from, opts.to];
    let where = `payment_date BETWEEN $1 AND $2 AND status <> 'failed'`;
    if (opts.branchId) {
      params.push(opts.branchId);
      where += ` AND branch_id = $${params.length}`;
    }
    if (opts.method) {
      params.push(opts.method);
      where += ` AND method = $${params.length}`;
    }
    const byMethod = await tx.query(
      `SELECT method, sum(amount)::bigint::text AS total, count(*)::int AS count
       FROM payments WHERE ${where}
       GROUP BY method ORDER BY sum(amount) DESC`,
      params,
    );
    const byDay = await tx.query(
      `SELECT payment_date::text AS day, sum(amount)::bigint::text AS total
       FROM payments WHERE ${where}
       GROUP BY payment_date ORDER BY payment_date`,
      params,
    );
    const total = await tx.query(
      `SELECT coalesce(sum(amount),0)::bigint::text AS total
       FROM payments WHERE ${where}`,
      params,
    );

    // Refunds over the same window, matched on the branch/method of the
    // payment they reverse so the filters mean the same thing on both sides.
    const refundParams: unknown[] = [opts.from, opts.to];
    let refundWhere = `(r.created_at AT TIME ZONE t.default_timezone)::date BETWEEN $1 AND $2`;
    if (opts.branchId) {
      refundParams.push(opts.branchId);
      refundWhere += ` AND p.branch_id = $${refundParams.length}`;
    }
    if (opts.method) {
      refundParams.push(opts.method);
      refundWhere += ` AND p.method = $${refundParams.length}`;
    }
    const refunds = await tx.query(
      `SELECT coalesce(sum(r.amount),0)::bigint::text AS total
       FROM refunds r
       JOIN payments p ON p.id = r.payment_id
       JOIN tenants t ON t.id = r.tenant_id
       WHERE ${refundWhere}`,
      refundParams,
    );

    const gross = BigInt((total.rows[0] as { total: string }).total);
    const refunded = BigInt((refunds.rows[0] as { total: string }).total);
    return {
      byMethod: byMethod.rows as never,
      byDay: byDay.rows as never,
      gross: gross.toString(),
      refunds: refunded.toString(),
      total: (gross - refunded).toString(),
    };
  });
}

export interface PlanMixRow {
  plan_name: string;
  active_count: number;
  revenue: string;
}

export async function planMixReport(user: SessionUser): Promise<PlanMixRow[]> {
  return asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(
      `SELECT plan_name_snapshot AS plan_name,
              count(*) FILTER (WHERE state = 'active')::int AS active_count,
              sum(total_amount)::bigint::text AS revenue
       FROM memberships GROUP BY plan_name_snapshot ORDER BY count(*) DESC`,
    );
    return r.rows as PlanMixRow[];
  });
}

/** Tenant-scoped CSV export (RLS guarantees no cross-tenant rows). */
export async function exportCsv(
  user: SessionUser,
  kind: 'members' | 'memberships' | 'payments' | 'attendance' | 'dues',
): Promise<string> {
  const queries: Record<string, string> = {
    members: `SELECT membership_number, first_name, coalesce(last_name,'') AS last_name, mobile,
                     coalesce(email,'') AS email, status, join_date::text AS join_date,
                     coalesce(village,'') AS village, coalesce(district,'') AS district
              FROM members WHERE archived_at IS NULL ORDER BY membership_number`,
    memberships: `SELECT m.membership_number, ms.plan_name_snapshot AS plan,
                         ms.start_date::text AS start_date, ms.end_date::text AS end_date, ms.state,
                         ms.total_amount::bigint AS total_paise, ms.discount_amount::bigint AS discount_paise
                  FROM memberships ms JOIN members m ON m.id = ms.member_id
                  ORDER BY ms.start_date DESC`,
    payments: `SELECT r.receipt_number, m.membership_number,
                      p.payment_date::text AS payment_date, p.amount::bigint AS amount_paise,
                      coalesce((SELECT sum(rf.amount) FROM refunds rf WHERE rf.payment_id = p.id), 0)::bigint
                        AS refunded_paise,
                      (p.amount - coalesce((SELECT sum(rf.amount) FROM refunds rf WHERE rf.payment_id = p.id), 0))::bigint
                        AS net_paise,
                      p.method, coalesce(p.external_reference,'') AS reference, p.status
               FROM payments p
               JOIN members m ON m.id = p.member_id
               LEFT JOIN receipts r ON r.payment_id = p.id
               ORDER BY p.payment_date DESC`,
    attendance: `SELECT m.membership_number, a.checked_in_at::text AS checked_in_at, a.method
                 FROM attendance a JOIN members m ON m.id = a.member_id
                 ORDER BY a.checked_in_at DESC`,
    // Who still owes money, for the follow-up list.
    dues: `SELECT m.membership_number, m.first_name || coalesce(' ' || m.last_name,'') AS name,
                  m.mobile, ms.plan_name_snapshot AS plan, ms.state,
                  ms.start_date::text AS start_date, ms.end_date::text AS end_date,
                  ms.total_amount::bigint AS total_paise,
                  ${PAID_AGAINST_MEMBERSHIP}::bigint AS paid_paise,
                  ${DUE_ON_MEMBERSHIP}::bigint AS due_paise
           FROM memberships ms
           JOIN members m ON m.id = ms.member_id
           WHERE ms.state IN ${LIVE_MEMBERSHIP_STATES}
             AND ${DUE_ON_MEMBERSHIP} > 0
           ORDER BY ${DUE_ON_MEMBERSHIP} DESC`,
  };
  return asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(queries[kind]!);
    const rows = r.rows as Record<string, unknown>[];
    if (rows.length === 0) return '';
    const headers = Object.keys(rows[0]!);
    const escape = (v: unknown) => {
      let s = v == null ? '' : String(v);
      // Spreadsheet formula-injection guard: neutralize leading =,+,-,@
      if (/^[=+\-@]/.test(s)) s = `'${s}`;
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [
      headers.join(','),
      ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
    ].join('\n');
  });
}
