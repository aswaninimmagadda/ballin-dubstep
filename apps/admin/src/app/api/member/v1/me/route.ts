import { NextResponse, type NextRequest } from 'next/server';
import { deriveMembershipStatus, daysRemaining } from '@gymflow/core';
import { todayInTz } from '@gymflow/utils';
import { asPrincipal } from '@/lib/db';
import { isErrorResponse, memberAuth } from '@/lib/member-api';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = memberAuth(req);
  if (isErrorResponse(auth)) return auth;
  const today = todayInTz();

  const data = await asPrincipal(auth.claims, async (tx) => {
    const member = await tx.query(
      `SELECT m.id, m.membership_number, m.first_name, m.last_name, m.photo_path,
              m.mobile, m.email, m.emergency_contact_name, m.emergency_contact_phone,
              b.name AS branch_name, t.name AS gym_name,
              br.logo_path, br.primary_color, br.support_phone, br.support_whatsapp
       FROM members m
       JOIN branches b ON b.id = m.branch_id
       JOIN tenants t ON t.id = m.tenant_id
       LEFT JOIN brands br ON br.tenant_id = m.tenant_id
       WHERE m.id = $1`,
      [auth.memberId],
    );
    // Prefer the running membership over a pre-sold pending renewal; a
    // pending row whose start date arrived beats a lapsed running row.
    const membership = await tx.query(
      `SELECT id, plan_name_snapshot, start_date::text AS start_date,
              end_date::text AS end_date, state, grace_period_days
       FROM memberships
       WHERE member_id = $1 AND state IN ('pending','active','frozen')
       ORDER BY CASE
         WHEN state IN ('active','frozen') AND end_date >= $2::date THEN 0
         WHEN state = 'pending' AND start_date <= $2::date THEN 1
         WHEN state IN ('active','frozen') THEN 2
         ELSE 3
       END, end_date DESC LIMIT 1`,
      [auth.memberId, today],
    );
    return {
      member: member.rows[0] as Record<string, unknown> | undefined,
      membership: membership.rows[0] as Record<string, unknown> | undefined,
    };
  });
  if (!data.member) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let membership: Record<string, unknown> | null = null;
  if (data.membership) {
    const status = deriveMembershipStatus(
      {
        state: data.membership.state as never,
        startDate: data.membership.start_date as string,
        endDate: data.membership.end_date as string,
        gracePeriodDays: data.membership.grace_period_days as number,
      },
      today,
    );
    membership = {
      planName: data.membership.plan_name_snapshot,
      startDate: data.membership.start_date,
      endDate: data.membership.end_date,
      status,
      daysRemaining: daysRemaining(data.membership.end_date as string, today),
    };
  }

  const m = data.member;
  return NextResponse.json({
    member: {
      id: m.id,
      membershipNumber: m.membership_number,
      firstName: m.first_name,
      lastName: m.last_name,
      photoPath: m.photo_path,
      branchName: m.branch_name,
    },
    gym: {
      name: m.gym_name,
      logoPath: m.logo_path,
      primaryColor: m.primary_color,
      supportPhone: m.support_phone,
      supportWhatsapp: m.support_whatsapp,
    },
    membership,
  });
}
