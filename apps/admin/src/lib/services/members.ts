import 'server-only';
import { asPrincipal } from '../db';
import { writeAudit } from '../audit';
import type { SessionUser } from '../session';
import type { CreateMemberInput } from '@gymflow/validation';
import { maskPhone } from '@gymflow/utils';

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
}

export async function searchMembers(
  user: SessionUser,
  opts: { q?: string; status?: string; limit?: number; offset?: number },
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
    const total = await tx.query(
      `SELECT count(*)::int AS n FROM members m ${where}`,
      params,
    );
    params.push(limit, offset);
    const rows = await tx.query(
      `SELECT m.id, m.membership_number, m.first_name, m.last_name, m.mobile, m.status,
              b.name AS branch_name, ms.plan_name_snapshot AS plan_name, ms.end_date::text AS end_date
       FROM members m
       JOIN branches b ON b.id = m.branch_id
       LEFT JOIN LATERAL (
         SELECT plan_name_snapshot, end_date FROM memberships
         WHERE member_id = m.id AND state IN ('pending','active','frozen')
         ORDER BY end_date DESC LIMIT 1
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
): Promise<{ id: string; first_name: string; last_name: string | null; membership_number: string; mobile: string }[]> {
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
               coalesce($20::date, CURRENT_DATE),$21,$22,$23,$24,$25,'pending_activation')
       RETURNING id`,
      [
        user.tenantId, input.branchId, membershipNumber, input.firstName,
        input.lastName ?? null, input.preferredName ?? null, input.gender ?? null,
        input.dateOfBirth ?? null, input.mobile, input.altMobile ?? null,
        input.email ?? null, input.addressLine1 ?? null, input.village ?? null,
        input.district ?? null, input.state ?? 'Andhra Pradesh', input.pinCode ?? null,
        input.emergencyContactName ?? null, input.emergencyContactRelation ?? null,
        input.emergencyContactPhone ?? null, input.joinDate ?? null,
        input.referralSource ?? null, input.referredByMemberId ?? null,
        input.assignedTrainerId ?? null, input.notes ?? null, input.tags,
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
              ms.base_end_date::text AS base_end_date
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
