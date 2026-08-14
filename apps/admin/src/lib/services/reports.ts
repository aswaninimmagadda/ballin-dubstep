import 'server-only';
import { asPrincipal } from '../db';
import type { SessionUser } from '../session';

export interface CollectionsSummary {
  byMethod: { method: string; total: string; count: number }[];
  byDay: { day: string; total: string }[];
  total: string;
}

export async function collectionsReport(
  user: SessionUser,
  opts: { from: string; to: string },
): Promise<CollectionsSummary> {
  return asPrincipal(user.claims, async (tx) => {
    const byMethod = await tx.query(
      `SELECT method, sum(amount)::bigint::text AS total, count(*)::int AS count
       FROM payments WHERE payment_date BETWEEN $1 AND $2 AND status <> 'failed'
       GROUP BY method ORDER BY sum(amount) DESC`,
      [opts.from, opts.to],
    );
    const byDay = await tx.query(
      `SELECT payment_date::text AS day, sum(amount)::bigint::text AS total
       FROM payments WHERE payment_date BETWEEN $1 AND $2 AND status <> 'failed'
       GROUP BY payment_date ORDER BY payment_date`,
      [opts.from, opts.to],
    );
    const total = await tx.query(
      `SELECT coalesce(sum(amount),0)::bigint::text AS total
       FROM payments WHERE payment_date BETWEEN $1 AND $2 AND status <> 'failed'`,
      [opts.from, opts.to],
    );
    return {
      byMethod: byMethod.rows as never,
      byDay: byDay.rows as never,
      total: (total.rows[0] as { total: string }).total,
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
  kind: 'members' | 'memberships' | 'payments' | 'attendance',
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
                      p.method, coalesce(p.external_reference,'') AS reference, p.status
               FROM payments p
               JOIN members m ON m.id = p.member_id
               LEFT JOIN receipts r ON r.payment_id = p.id
               ORDER BY p.payment_date DESC`,
    attendance: `SELECT m.membership_number, a.checked_in_at::text AS checked_in_at, a.method
                 FROM attendance a JOIN members m ON m.id = a.member_id
                 ORDER BY a.checked_in_at DESC`,
  };
  return asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(queries[kind]!);
    const rows = r.rows as Record<string, unknown>[];
    if (rows.length === 0) return '';
    const headers = Object.keys(rows[0]!);
    const escape = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [
      headers.join(','),
      ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
    ].join('\n');
  });
}
