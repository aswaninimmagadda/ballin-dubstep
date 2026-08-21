import 'server-only';
import { asPrincipal } from '../db';
import { writeAudit } from '../audit';
import type { SessionUser } from '../session';
import type { CreateMemberInput } from '@gymflow/validation';
import { maskPhone, todayInTz } from '@gymflow/utils';
import { DUE_ON_MEMBERSHIP, LIVE_MEMBERSHIP_STATES, PAID_AGAINST_MEMBERSHIP } from './money-sql';

export interface MemberListRow {
  id: string;
  membership_number: string;
  first_name: string;
  last_name: string | null;
  mobile: string;
  status: string;
  branch_name: string;
  plan_name: string | null;
  end_date: string | null;
  due_amount: string | null;
}

export async function searchMembers(
  user: SessionUser,
  opts: { q?: string; status?: string; duesOnly?: boolean; limit?: number; offset?: number },
): Promise<{ rows: MemberListRow[]; total: number }> {
  const q = (opts.q ?? '').trim();
  const limit = Math.min(opts.limit ?? 25, 100);
  const offset = opts.offset ?? 0;
  return asPrincipal(user.claims, async (tx) => {
    const params: unknown[] = [];
    let where = 'WHERE m.archived_at IS NULL';
    if (q) {
      params.push(`%${q}%`);
      const p = `$${params.length}`;
      // digits → phone/membership number prefix; text → trigram name match
      where += ` AND (m.first_name || ' ' || coalesce(m.last_name,'') ILIKE ${p}
        OR m.mobile LIKE ${p} OR m.membership_number ILIKE ${p})`;
    }
    if (opts.status) {
      params.push(opts.status);
      where += ` AND m.status = $${params.length}`;
    }
    if (opts.duesOnly) {
      where += ` AND EXISTS (
        SELECT 1 FROM memberships ms
        WHERE ms.member_id = m.id AND ms.state IN ${LIVE_MEMBERSHIP_STATES}
          AND ${DUE_ON_MEMBERSHIP} > 0)`;
    }
    const total = await tx.query(`SELECT count(*)::int AS n FROM members m ${where}`, params);
    params.push(todayInTz());
    const pToday = `$${params.length}`;
    params.push(limit, offset);
    const rows = await tx.query(
      `SELECT m.id, m.membership_number, m.first_name, m.last_name, m.mobile, m.status,
              b.name AS branch_name, ms.plan_name_snapshot AS plan_name, ms.end_date::text AS end_date,
              ms.due_amount
       FROM members m
       JOIN branches b ON b.id = m.branch_id
       LEFT JOIN LATERAL (
         SELECT ms.plan_name_snapshot, ms.end_date, ${DUE_ON_MEMBERSHIP}::bigint::text AS due_amount
         FROM memberships ms
         WHERE ms.member_id = m.id AND ms.state IN ('pending','active','frozen')
         ORDER BY CASE
           WHEN ms.state IN ('active','frozen') AND ms.end_date >= ${pToday}::date THEN 0
           WHEN ms.state = 'pending' AND ms.start_date <= ${pToday}::date THEN 1
           WHEN ms.state IN ('active','frozen') THEN 2
           ELSE 3
         END, ms.end_date DESC LIMIT 1
       ) ms ON true
       ${where}
       ORDER BY m.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      rows: rows.rows as MemberListRow[],
      total: (total.rows[0] as { n: number }).n,
    };
  });
}

export async function findDuplicates(
  user: SessionUser,
  mobile: string,
): Promise<
  {
    id: string;
    first_name: string;
    last_name: string | null;
    membership_number: string;
    mobile: string;
  }[]
> {
  return asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(
      `SELECT id, first_name, last_name, membership_number, mobile
       FROM members WHERE (mobile = $1 OR alt_mobile = $1) AND archived_at IS NULL`,
      [mobile],
    );
    return r.rows as never;
  });
}

export async function createMember(
  user: SessionUser,
  input: CreateMemberInput,
): Promise<{ id: string; membershipNumber: string }> {
  return asPrincipal(user.claims, async (tx) => {
    const num = await tx.query(`SELECT app.next_membership_number($1) AS n`, [user.tenantId]);
    const membershipNumber = (num.rows[0] as { n: string }).n;
    const r = await tx.query(
      `INSERT INTO members
        (tenant_id, branch_id, membership_number, first_name, last_name, preferred_name,
         gender, date_of_birth, mobile, alt_mobile, email, address_line1, village, district,
         state, pin_code, emergency_contact_name, emergency_contact_relation,
         emergency_contact_phone, join_date, referral_source, referred_by_member_id,
         assigned_trainer_id, notes, tags, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
               coalesce($20::date, $26::date),$21,$22,$23,$24,$25,'pending_activation')
       RETURNING id`,
      [
        user.tenantId,
        input.branchId,
        membershipNumber,
        input.firstName,
        input.lastName ?? null,
        input.preferredName ?? null,
        input.gender ?? null,
        input.dateOfBirth ?? null,
        input.mobile,
        input.altMobile ?? null,
        input.email ?? null,
        input.addressLine1 ?? null,
        input.village ?? null,
        input.district ?? null,
        input.state ?? 'Andhra Pradesh',
        input.pinCode ?? null,
        input.emergencyContactName ?? null,
        input.emergencyContactRelation ?? null,
        input.emergencyContactPhone ?? null,
        input.joinDate ?? null,
        input.referralSource ?? null,
        input.referredByMemberId ?? null,
        input.assignedTrainerId ?? null,
        input.notes ?? null,
        input.tags,
        // The gym's calendar day — CURRENT_DATE is the server's UTC day, which
        // is still "yesterday" during the IST evening.
        todayInTz(),
      ],
    );
    const id = (r.rows[0] as { id: string }).id;
    await tx.query(
      `INSERT INTO member_status_history (tenant_id, member_id, from_status, to_status, changed_by)
       VALUES ($1, $2, NULL, 'pending_activation', $3)`,
      [user.tenantId, id, user.userId],
    );
    await writeAudit(tx, user, {
      action: 'member.create',
      entityType: 'member',
      entityId: id,
      after: { membershipNumber, firstName: input.firstName, mobile: maskPhone(input.mobile) },
    });
    return { id, membershipNumber };
  });
}

export interface MemberDetail {
  member: Record<string, unknown>;
  currentMembership: Record<string, unknown> | null;
  memberships: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  attendance: Record<string, unknown>[];
  addons: Record<string, unknown>[];
  openFreeze: Record<string, unknown> | null;
}

export async function getMemberDetail(user: SessionUser, id: string): Promise<MemberDetail | null> {
  return asPrincipal(user.claims, async (tx) => {
    const m = await tx.query(
      `SELECT m.*, b.name AS branch_name, t.name AS trainer_name
       FROM members m
       JOIN branches b ON b.id = m.branch_id
       LEFT JOIN trainers t ON t.id = m.assigned_trainer_id
       WHERE m.id = $1`,
      [id],
    );
    if (!m.rows[0]) return null;
    const memberships = await tx.query(
      `SELECT ms.*, ms.start_date::text AS start_date, ms.end_date::text AS end_date,
              ms.base_end_date::text AS base_end_date,
              ${PAID_AGAINST_MEMBERSHIP}::bigint::text AS paid_amount,
              ${DUE_ON_MEMBERSHIP}::bigint::text AS due_amount
       FROM memberships ms WHERE member_id = $1 ORDER BY ms.start_date DESC`,
      [id],
    );
    const payments = await tx.query(
      `SELECT p.*, p.payment_date::text AS payment_date, r.receipt_number
       FROM payments p LEFT JOIN receipts r ON r.payment_id = p.id
       WHERE p.member_id = $1 ORDER BY p.created_at DESC LIMIT 50`,
      [id],
    );
    const attendance = await tx.query(
      `SELECT * FROM attendance WHERE member_id = $1 ORDER BY checked_in_at DESC LIMIT 30`,
      [id],
    );
    const addons = await tx.query(
      `SELECT ma.*, ma.start_date::text AS start_date, ma.end_date::text AS end_date,
              t.name AS trainer_name
       FROM member_addons ma LEFT JOIN trainers t ON t.id = ma.trainer_id
       WHERE ma.member_id = $1 ORDER BY ma.created_at DESC`,
      [id],
    );
    // Current = the running membership (active/frozen), else the upcoming
    // pending one — a member can hold both during an early renewal.
    const rows = memberships.rows as Record<string, unknown>[];
    const current =
      rows.find((r) => ['active', 'frozen'].includes(r.state as string)) ??
      rows.find((r) => r.state === 'pending');
    let openFreeze: Record<string, unknown> | null = null;
    if (current && current.state === 'frozen') {
      const f = await tx.query(
        `SELECT *, start_date::text AS start_date, planned_end_date::text AS planned_end_date
         FROM membership_freezes
         WHERE membership_id = $1 AND actual_end_date IS NULL LIMIT 1`,
        [current.id],
      );
      openFreeze = (f.rows[0] as Record<string, unknown>) ?? null;
    }
    return {
      member: m.rows[0] as Record<string, unknown>,
      currentMembership: current ?? null,
      memberships: memberships.rows as Record<string, unknown>[],
      payments: payments.rows as Record<string, unknown>[],
      attendance: attendance.rows as Record<string, unknown>[],
      addons: addons.rows as Record<string, unknown>[],
      openFreeze,
    };
  });
}

/**
 * Enable member-app access: creates the member's login (sealed definer
 * function) and returns the one-time password reception hands to the member.
 */
export async function enableMemberApp(
  user: SessionUser,
  memberId: string,
): Promise<{ password: string; gymCode: string }> {
  const { randomBytes } = await import('node:crypto');
  const { hashPassword } = await import('@gymflow/core');
  const password = randomBytes(6).toString('base64url'); // 8 chars
  const hash = await hashPassword(password);
  const gymCode = await asPrincipal(user.claims, async (tx) => {
    await tx.query(`SELECT app.member_app_enable($1, $2)`, [memberId, hash]);
    const t = await tx.query(`SELECT slug FROM tenants WHERE id = $1`, [user.tenantId]);
    await writeAudit(tx, user, {
      action: 'member.app_enable',
      entityType: 'member',
      entityId: memberId,
    });
    return (t.rows[0] as { slug: string }).slug;
  });
  return { password, gymCode };
}

/**
 * Archive a member (soft delete — §85 forbids destroying history). Only
 * possible once nothing is live; frees the mobile number for re-use
 * (the tenant+mobile unique index is partial on archived_at IS NULL) and
 * ends any member-app sessions.
 */
export async function archiveMember(user: SessionUser, memberId: string): Promise<void> {
  const { UserFacingError } = await import('../errors');
  return asPrincipal(user.claims, async (tx) => {
    const mR = await tx.query(
      `SELECT id, status, user_id, first_name FROM members WHERE id = $1 AND archived_at IS NULL`,
      [memberId],
    );
    const m = mR.rows[0] as
      { id: string; status: string; user_id: string | null; first_name: string } | undefined;
    if (!m) throw new UserFacingError('Member not found (or already archived).');
    const live = await tx.query(
      `SELECT 1 FROM memberships WHERE member_id = $1 AND state IN ('active','frozen','pending') LIMIT 1`,
      [memberId],
    );
    if (live.rows.length > 0) {
      throw new UserFacingError(
        'This member still has a live membership. Cancel it before archiving.',
      );
    }
    await tx.query(`UPDATE members SET archived_at = now(), status = 'archived' WHERE id = $1`, [
      memberId,
    ]);
    await tx.query(
      `INSERT INTO member_status_history (tenant_id, member_id, from_status, to_status, changed_by)
       VALUES ($1, $2, $3, 'archived', $4)`,
      [user.tenantId, memberId, m.status, user.userId],
    );
    if (m.user_id) {
      await tx.query(`SELECT app.sessions_revoke_all($1)`, [m.user_id]);
    }
    await writeAudit(tx, user, {
      action: 'member.archive',
      entityType: 'member',
      entityId: memberId,
      before: { status: m.status },
      after: { status: 'archived' },
    });
  });
}

export interface UpdateMemberPatch {
  branchId?: string;
  firstName?: string;
  lastName?: string | null;
  preferredName?: string | null;
  gender?: string | null;
  dateOfBirth?: string | null;
  mobile?: string;
  altMobile?: string | null;
  email?: string | null;
  addressLine1?: string | null;
  village?: string | null;
  district?: string | null;
  state?: string | null;
  pinCode?: string | null;
  emergencyContactName?: string | null;
  emergencyContactRelation?: string | null;
  emergencyContactPhone?: string | null;
  assignedTrainerId?: string | null;
  notes?: string | null;
  tags?: string[];
}

/**
 * Which column each patch field writes to, and how it must be cast. This is
 * a fixed allowlist — nothing from the request reaches the SQL text.
 */
const MEMBER_COLUMNS: Record<keyof UpdateMemberPatch, { column: string; cast?: string }> = {
  branchId: { column: 'branch_id', cast: 'uuid' },
  firstName: { column: 'first_name' },
  lastName: { column: 'last_name' },
  preferredName: { column: 'preferred_name' },
  gender: { column: 'gender' },
  dateOfBirth: { column: 'date_of_birth', cast: 'date' },
  mobile: { column: 'mobile' },
  altMobile: { column: 'alt_mobile' },
  email: { column: 'email' },
  addressLine1: { column: 'address_line1' },
  village: { column: 'village' },
  district: { column: 'district' },
  state: { column: 'state' },
  pinCode: { column: 'pin_code' },
  emergencyContactName: { column: 'emergency_contact_name' },
  emergencyContactRelation: { column: 'emergency_contact_relation' },
  emergencyContactPhone: { column: 'emergency_contact_phone' },
  assignedTrainerId: { column: 'assigned_trainer_id', cast: 'uuid' },
  notes: { column: 'notes' },
  tags: { column: 'tags', cast: 'text[]' },
};

/**
 * Edit a member profile (incl. branch transfer).
 *
 * A key absent from the patch is left alone; a key present with `null` is
 * CLEARED. That distinction is the whole point: the form previously folded
 * "blank" into "unchanged", so deleting a wrongly-typed email or emergency
 * number did nothing while still reporting success.
 */
export async function updateMember(
  user: SessionUser,
  memberId: string,
  patch: UpdateMemberPatch,
): Promise<void> {
  return asPrincipal(user.claims, async (tx) => {
    const beforeR = await tx.query(
      `SELECT branch_id, first_name, last_name, mobile, village, district, assigned_trainer_id
       FROM members WHERE id = $1`,
      [memberId],
    );
    const before = beforeR.rows[0] as Record<string, unknown> | undefined;
    if (!before) {
      const { UserFacingError } = await import('../errors');
      throw new UserFacingError('Member not found.');
    }
    const sets: string[] = [];
    const params: unknown[] = [memberId];
    for (const [key, spec] of Object.entries(MEMBER_COLUMNS)) {
      const field = key as keyof UpdateMemberPatch;
      if (!(field in patch)) continue; // untouched — leave the column alone
      const value = patch[field];
      if (value === undefined) continue;
      params.push(value);
      sets.push(`${spec.column} = $${params.length}${spec.cast ? `::${spec.cast}` : ''}`);
    }
    if (sets.length === 0) return; // nothing to do — don't claim an edit
    const r = await tx.query(`UPDATE members SET ${sets.join(', ')} WHERE id = $1`, params);
    if (r.rowCount === 0) {
      const { UserFacingError } = await import('../errors');
      throw new UserFacingError('You do not have permission to edit this member.');
    }
    if (patch.mobile && patch.mobile !== before.mobile) {
      // Member-app logins are keyed by phone; keep the login in step so the
      // member isn't locked out (and the old number can't log in).
      await tx.query(`SELECT app.member_sync_login_phone($1)`, [memberId]);
    }
    await writeAudit(tx, user, {
      action: 'member.edit',
      entityType: 'member',
      entityId: memberId,
      before: {
        branchId: before.branch_id,
        name: `${before.first_name} ${before.last_name ?? ''}`.trim(),
        mobile: maskPhone(String(before.mobile)),
      },
      after: {
        branchId: patch.branchId ?? before.branch_id,
        edited: Object.keys(patch).filter((k) => patch[k as keyof UpdateMemberPatch] !== undefined),
      },
    });
  });
}
