import 'server-only';
import { deriveMembershipStatus, allowsCheckin, verifyMemberPassToken } from '@gymflow/core';
import { todayInTz } from '@gymflow/utils';
import { PLATFORM_DEFAULTS } from '@gymflow/config';
import { asPrincipal } from '../db';
import { writeAudit } from '../audit';
import { UserFacingError } from '../errors';
import { env } from '../env';
import type { SessionUser } from '../session';

export interface CheckinPreview {
  memberId: string;
  name: string;
  membershipNumber: string;
  photoPath: string | null;
  planName: string | null;
  endDate: string | null;
  derivedStatus: string | null;
  allowed: boolean;
  warning: string | null;
}

/**
 * Pick the membership that governs entry today. A member can hold a running
 * (active/frozen) row AND a pending early renewal at once — prefer the row
 * that is current as of today, then a renewal whose start date has arrived,
 * then a lapsed running row (grace), and only last a future pending row.
 */
const RELEVANT_MEMBERSHIP_ORDER = (todayParam: string) => `
  CASE
    WHEN state IN ('active','frozen') AND end_date >= ${todayParam}::date THEN 0
    WHEN state = 'pending' AND start_date <= ${todayParam}::date THEN 1
    WHEN state IN ('active','frozen') THEN 2
    ELSE 3
  END, end_date DESC`;

export async function previewCheckin(user: SessionUser, memberId: string): Promise<CheckinPreview> {
  const today = todayInTz();
  return asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(
      `SELECT m.id, m.first_name || coalesce(' ' || m.last_name,'') AS name,
              m.membership_number, m.photo_path,
              ms.plan_name_snapshot, ms.start_date::text AS start_date,
              ms.end_date::text AS end_date, ms.state, ms.grace_period_days
       FROM members m
       LEFT JOIN LATERAL (
         SELECT * FROM memberships WHERE member_id = m.id AND state IN ('pending','active','frozen')
         ORDER BY ${RELEVANT_MEMBERSHIP_ORDER('$2')} LIMIT 1
       ) ms ON true
       WHERE m.id = $1`,
      [memberId, today],
    );
    const row = r.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new UserFacingError('Member not found.');
    let derived: string | null = null;
    let allowed = false;
    let warning: string | null = null;
    if (row.state) {
      derived = deriveMembershipStatus(
        {
          state: row.state as never,
          startDate: row.start_date as string,
          endDate: row.end_date as string,
          gracePeriodDays: row.grace_period_days as number,
        },
        today,
      );
      allowed = allowsCheckin(derived as never);
      if (derived === 'frozen') warning = 'frozen';
      else if (derived === 'grace_period') warning = 'grace';
      else if (!allowed) warning = 'expired';
    } else {
      // check most recent membership of any state for context
      const last = await tx.query(
        `SELECT plan_name_snapshot, end_date::text AS end_date FROM memberships
         WHERE member_id = $1 ORDER BY end_date DESC LIMIT 1`,
        [memberId],
      );
      const l = last.rows[0] as Record<string, unknown> | undefined;
      if (l) {
        row.plan_name_snapshot = l.plan_name_snapshot;
        row.end_date = l.end_date;
      }
      warning = 'expired';
    }
    return {
      memberId: row.id as string,
      name: row.name as string,
      membershipNumber: row.membership_number as string,
      photoPath: (row.photo_path as string) ?? null,
      planName: (row.plan_name_snapshot as string) ?? null,
      endDate: (row.end_date as string) ?? null,
      derivedStatus: derived,
      allowed,
      warning,
    };
  });
}

export async function checkinMember(
  user: SessionUser,
  opts: { memberId: string; method: 'reception' | 'qr' | 'manual'; override?: boolean },
): Promise<{ ok: true } | { ok: false; duplicate?: true; blocked?: true }> {
  const today = todayInTz();
  return asPrincipal(user.claims, async (tx) => {
    const mR = await tx.query(`SELECT id, branch_id FROM members WHERE id = $1`, [opts.memberId]);
    const m = mR.rows[0] as { id: string; branch_id: string } | undefined;
    if (!m) throw new UserFacingError('Member not found.');

    // Server-side gate: the client's allowed/blocked preview is advisory only.
    const msR = await tx.query(
      `SELECT state, start_date::text AS start_date, end_date::text AS end_date, grace_period_days
       FROM memberships WHERE member_id = $1 AND state IN ('pending','active','frozen')
       ORDER BY ${RELEVANT_MEMBERSHIP_ORDER('$2')} LIMIT 1`,
      [m.id, today],
    );
    const ms = msR.rows[0] as
      | { state: string; start_date: string; end_date: string; grace_period_days: number }
      | undefined;
    const derived = ms
      ? deriveMembershipStatus(
          {
            state: ms.state as never,
            startDate: ms.start_date,
            endDate: ms.end_date,
            gracePeriodDays: ms.grace_period_days,
          },
          today,
        )
      : null;
    const allowed = derived != null && allowsCheckin(derived);
    if (!allowed && !opts.override) {
      return { ok: false as const, blocked: true as const };
    }

    // Duplicate-tap guard: skip if checked in within the window.
    const dup = await tx.query(
      `SELECT 1 FROM attendance
       WHERE member_id = $1 AND checked_in_at > now() - make_interval(mins => $2)`,
      [m.id, PLATFORM_DEFAULTS.duplicateCheckinWindowMinutes],
    );
    if (dup.rows.length > 0) return { ok: false as const, duplicate: true as const };

    await tx.query(
      `INSERT INTO attendance (tenant_id, branch_id, member_id, method, checked_in_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [user.tenantId, m.branch_id, m.id, opts.method, user.userId],
    );
    // The override audit is written whenever entry was granted despite an
    // inactive membership — decided server-side, not by the form flag.
    if (!allowed) {
      await writeAudit(tx, user, {
        action: 'attendance.override',
        entityType: 'member',
        entityId: m.id,
        after: { derivedStatus: derived ?? 'no_membership' },
      });
    }
    return { ok: true as const };
  });
}

/** Resolve a scanned QR pass token into a member (server-side verification). */
export async function resolveQrToken(user: SessionUser, token: string): Promise<string> {
  const result = verifyMemberPassToken(env.memberTokenSecret, token);
  if (!result.valid || !result.memberId) {
    throw new UserFacingError(
      'QR code is invalid or has expired. Ask the member to refresh their pass.',
    );
  }
  // The member must belong to this staff user's tenant (RLS enforces on read).
  const found = await asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(`SELECT id FROM members WHERE id = $1`, [result.memberId]);
    return r.rows[0] as { id: string } | undefined;
  });
  if (!found) throw new UserFacingError('This pass does not belong to a member of this gym.');
  return found.id;
}

export async function todayCheckins(
  user: SessionUser,
): Promise<
  { id: string; name: string; membership_number: string; checked_in_at: string; method: string }[]
> {
  const today = todayInTz();
  return asPrincipal(user.claims, async (tx) => {
    // "Today" is the tenant's calendar day, not the server's (UTC) day.
    const r = await tx.query(
      `SELECT a.id, m.first_name || coalesce(' ' || m.last_name,'') AS name,
              m.membership_number, a.checked_in_at::text AS checked_in_at, a.method
       FROM attendance a
       JOIN members m ON m.id = a.member_id
       JOIN tenants t ON t.id = a.tenant_id
       WHERE (a.checked_in_at AT TIME ZONE t.default_timezone)::date = $1::date
       ORDER BY a.checked_in_at DESC LIMIT 100`,
      [today],
    );
    return r.rows as never;
  });
}
