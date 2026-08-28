import 'server-only';
import { asPrincipal } from '../db';
import {
  COLLECTABLE_ADDON_STATES,
  COLLECTABLE_MEMBERSHIP_STATES,
  DUE_ON_ADDON,
  DUE_ON_MEMBERSHIP,
  PAID_AGAINST_ADDON,
  PAID_AGAINST_MEMBERSHIP,
} from './money-sql';
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
    // Net of refunds, like the headline above it. They used to disagree: the
    // card's total subtracted refunds and the per-method rows underneath it
    // did not, so the rows summed to more than the total and neither number
    // matched the drawer.
    const byMethod = await tx.query(
      `SELECT p.method,
              (sum(p.amount) - coalesce(sum((
                 SELECT coalesce(sum(rf.amount), 0) FROM refunds rf WHERE rf.payment_id = p.id
               )), 0))::bigint::text AS total,
              count(*)::int AS count
       FROM payments p WHERE ${where.replace('payment_date', 'p.payment_date').replace('status', 'p.status').replace('branch_id', 'p.branch_id').replace('method =', 'p.method =')}
       GROUP BY p.method ORDER BY 2 DESC`,
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
  /** Money actually collected against this plan, net of refunds. */
  collected: string;
  /** What was contracted and is still owed on live memberships. */
  outstanding: string;
}

/**
 * Which plans sell, and what they have actually brought in.
 *
 * This used to be `sum(total_amount)` over every membership row with no filter
 * at all, labelled "Revenue" and printed next to a cash figure: cancelled
 * memberships, never-paid memberships and fully refunded ones were all counted
 * as money earned. A plan sold once, never paid for and cancelled the next day
 * contributed its full price to "revenue" forever.
 *
 * Collected is now money that actually arrived and stayed; outstanding is what
 * is still owed on a collectable membership. Neither is guessed from the
 * contract value.
 */
export async function planMixReport(user: SessionUser): Promise<PlanMixRow[]> {
  return asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(
      `SELECT ms.plan_name_snapshot AS plan_name,
              count(*) FILTER (WHERE ms.state = 'active')::int AS active_count,
              sum(${PAID_AGAINST_MEMBERSHIP})::bigint::text AS collected,
              sum(CASE WHEN ms.state IN ${COLLECTABLE_MEMBERSHIP_STATES}
                       THEN GREATEST(${DUE_ON_MEMBERSHIP}, 0) ELSE 0 END)::bigint::text
                AS outstanding
       FROM memberships ms
       GROUP BY ms.plan_name_snapshot
       ORDER BY count(*) DESC`,
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
    // Memberships AND add-ons: a PT package sold on a deposit is a receivable
    // exactly like a part-paid membership, and used to appear in no report.
    dues: `SELECT * FROM (
             SELECT m.membership_number, m.first_name || coalesce(' ' || m.last_name,'') AS name,
                    m.mobile, 'membership' AS item_type, ms.plan_name_snapshot AS item, ms.state,
                    ms.start_date::text AS start_date, ms.end_date::text AS end_date,
                    ms.total_amount::bigint AS total_paise,
                    ${PAID_AGAINST_MEMBERSHIP}::bigint AS paid_paise,
                    ${DUE_ON_MEMBERSHIP}::bigint AS due_paise
             FROM memberships ms
             JOIN members m ON m.id = ms.member_id
             WHERE ms.state IN ${COLLECTABLE_MEMBERSHIP_STATES}
               AND ${DUE_ON_MEMBERSHIP} > 0
             UNION ALL
             SELECT m.membership_number, m.first_name || coalesce(' ' || m.last_name,'') AS name,
                    m.mobile, 'addon' AS item_type, ma.name_snapshot AS item, ma.state,
                    ma.start_date::text AS start_date, ma.end_date::text AS end_date,
                    ma.price_snapshot::bigint AS total_paise,
                    ${PAID_AGAINST_ADDON}::bigint AS paid_paise,
                    ${DUE_ON_ADDON}::bigint AS due_paise
             FROM member_addons ma
             JOIN members m ON m.id = ma.member_id
             WHERE ma.state IN ${COLLECTABLE_ADDON_STATES}
               AND ${DUE_ON_ADDON} > 0
           ) dues
           ORDER BY due_paise DESC`,
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
