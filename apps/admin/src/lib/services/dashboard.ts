import 'server-only';
import { todayInTz, addDays } from '@gymflow/utils';
import { asPrincipal } from '../db';
import { DUE_ON_MEMBERSHIP, LIVE_MEMBERSHIP_STATES } from './money-sql';
import type { SessionUser } from '../session';

export interface DashboardData {
  gymName: string;
  waTemplateEn: string;
  waTemplateTe: string;
  activeMembers: number;
  expiring7Days: number;
  expiredRecent: number;
  todayCollections: number;
  monthCollections: number;
  duesOutstanding: number;
  newMembersThisMonth: number;
  todayAttendance: number;
  leadsToFollowUp: number;
  expiryQueue: ExpiryRow[];
  recentPayments: PaymentRow[];
}

export interface ExpiryRow {
  member_id: string;
  first_name: string;
  last_name: string | null;
  mobile: string;
  membership_number: string;
  plan_name: string;
  end_date: string;
  days_left: number;
  membership_id: string;
}

export interface PaymentRow {
  id: string;
  amount: string;
  method: string;
  payment_date: string;
  member_name: string;
  receipt_number: string | null;
}

export async function getDashboard(user: SessionUser): Promise<DashboardData> {
  const today = todayInTz();
  const in7 = addDays(today, 7);
  const back7 = addDays(today, -7);
  const monthStart = `${today.slice(0, 7)}-01`;

  return asPrincipal(user.claims, async (tx) => {
    const counters = await tx.query(
      `SELECT
        (SELECT count(*) FROM memberships WHERE state = 'active' AND end_date >= $1)::int AS active_members,
        (SELECT count(*) FROM memberships WHERE state = 'active' AND end_date BETWEEN $1 AND $2)::int AS expiring_7,
        (SELECT count(*) FROM memberships WHERE state IN ('active','expired') AND end_date BETWEEN $3 AND $4)::int AS expired_recent,
        -- Collections are NET of refunds: a refund is counted on the day the
        -- money left the drawer (tenant calendar day), so the figure staff
        -- reconcile against actually balances.
        ((SELECT coalesce(sum(amount),0) FROM payments WHERE payment_date = $1 AND status <> 'failed')
         - (SELECT coalesce(sum(r.amount),0) FROM refunds r JOIN tenants t ON t.id = r.tenant_id
            WHERE (r.created_at AT TIME ZONE t.default_timezone)::date = $1::date))::bigint AS today_collections,
        ((SELECT coalesce(sum(amount),0) FROM payments WHERE payment_date >= $5 AND status <> 'failed')
         - (SELECT coalesce(sum(r.amount),0) FROM refunds r JOIN tenants t ON t.id = r.tenant_id
            WHERE (r.created_at AT TIME ZONE t.default_timezone)::date >= $5::date))::bigint AS month_collections,
        (SELECT coalesce(sum(GREATEST(${DUE_ON_MEMBERSHIP}, 0)), 0)
         FROM memberships ms WHERE ms.state IN ${LIVE_MEMBERSHIP_STATES})::bigint AS dues_outstanding,
        (SELECT count(*) FROM members WHERE join_date >= $5 AND status NOT IN ('lead','archived'))::int AS new_members_month,
        (SELECT count(*) FROM attendance a JOIN tenants t ON t.id = a.tenant_id
          WHERE (a.checked_in_at AT TIME ZONE t.default_timezone)::date = $1::date)::int AS today_attendance,
        (SELECT count(*) FROM leads WHERE status NOT IN ('won','lost') AND (follow_up_date IS NULL OR follow_up_date <= $1))::int AS leads_follow_up
      `,
      [today, in7, back7, addDays(today, -1), monthStart],
    );
    const c = counters.rows[0] as Record<string, string | number>;

    const queue = await tx.query(
      `SELECT m.id AS member_id, m.first_name, m.last_name, m.mobile, m.membership_number,
              ms.plan_name_snapshot AS plan_name, ms.end_date::text AS end_date,
              (ms.end_date - $1::date)::int AS days_left, ms.id AS membership_id
       FROM memberships ms
       JOIN members m ON m.id = ms.member_id
       WHERE ms.state = 'active' AND ms.end_date BETWEEN $2 AND $3
       ORDER BY ms.end_date ASC
       LIMIT 30`,
      [today, back7, in7],
    );

    const payments = await tx.query(
      `SELECT p.id, p.amount::bigint::text AS amount, p.method, p.payment_date::text AS payment_date,
              m.first_name || coalesce(' ' || m.last_name, '') AS member_name, r.receipt_number
       FROM payments p
       JOIN members m ON m.id = p.member_id
       LEFT JOIN receipts r ON r.payment_id = p.id
       ORDER BY p.created_at DESC LIMIT 10`,
    );

    const meta = await tx.query(
      `SELECT t.name AS gym_name, gs.whatsapp_renewal_template_en, gs.whatsapp_renewal_template_te
       FROM tenants t LEFT JOIN gym_settings gs ON gs.tenant_id = t.id
       WHERE t.id = $1`,
      [user.tenantId],
    );
    const metaRow = meta.rows[0] as
      | {
          gym_name: string;
          whatsapp_renewal_template_en: string;
          whatsapp_renewal_template_te: string;
        }
      | undefined;

    return {
      gymName: metaRow?.gym_name ?? '',
      waTemplateEn: metaRow?.whatsapp_renewal_template_en ?? '',
      waTemplateTe: metaRow?.whatsapp_renewal_template_te ?? '',
      activeMembers: Number(c.active_members),
      expiring7Days: Number(c.expiring_7),
      expiredRecent: Number(c.expired_recent),
      todayCollections: Number(c.today_collections),
      monthCollections: Number(c.month_collections),
      duesOutstanding: Number(c.dues_outstanding),
      newMembersThisMonth: Number(c.new_members_month),
      todayAttendance: Number(c.today_attendance),
      leadsToFollowUp: Number(c.leads_follow_up),
      expiryQueue: queue.rows as ExpiryRow[],
      recentPayments: payments.rows as PaymentRow[],
    };
  });
}
