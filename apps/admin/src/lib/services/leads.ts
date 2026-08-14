import 'server-only';
import { asPrincipal } from '../db';
import { writeAudit } from '../audit';
import type { SessionUser } from '../session';

export interface LeadRow {
  id: string;
  name: string;
  mobile: string;
  source: string;
  status: string;
  follow_up_date: string | null;
  notes: string | null;
  plan_name: string | null;
  created_at: string;
}

export async function listLeads(user: SessionUser, status?: string): Promise<LeadRow[]> {
  return asPrincipal(user.claims, async (tx) => {
    const params: unknown[] = [];
    let where = '';
    if (status) {
      params.push(status);
      where = `WHERE l.status = $1`;
    } else {
      where = `WHERE l.status NOT IN ('won','lost')`;
    }
    const r = await tx.query(
      `SELECT l.id, l.name, l.mobile, l.source, l.status,
              l.follow_up_date::text AS follow_up_date, l.notes,
              p.name AS plan_name, l.created_at::text AS created_at
       FROM leads l LEFT JOIN membership_plans p ON p.id = l.interested_plan_id
       ${where}
       ORDER BY l.follow_up_date NULLS LAST, l.created_at DESC LIMIT 200`,
      params,
    );
    return r.rows as LeadRow[];
  });
}

export async function createLead(
  user: SessionUser,
  input: {
    branchId: string;
    name: string;
    mobile: string;
    source: string;
    interestedPlanId?: string | null;
    preferredTiming?: string | null;
    followUpDate?: string | null;
    notes?: string | null;
  },
): Promise<string> {
  return asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(
      `INSERT INTO leads (tenant_id, branch_id, name, mobile, source, interested_plan_id,
                          preferred_timing, follow_up_date, notes, assigned_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        user.tenantId,
        input.branchId,
        input.name,
        input.mobile,
        input.source,
        input.interestedPlanId ?? null,
        input.preferredTiming ?? null,
        input.followUpDate ?? null,
        input.notes ?? null,
        user.userId,
      ],
    );
    const id = (r.rows[0] as { id: string }).id;
    await writeAudit(tx, user, { action: 'lead.create', entityType: 'lead', entityId: id });
    return id;
  });
}

export async function updateLeadStatus(
  user: SessionUser,
  input: { id: string; status: string; followUpDate?: string | null; notes?: string | null },
): Promise<void> {
  return asPrincipal(user.claims, async (tx) => {
    await tx.query(
      `UPDATE leads SET status = $2,
              follow_up_date = coalesce($3::date, follow_up_date),
              notes = coalesce($4, notes)
       WHERE id = $1`,
      [input.id, input.status, input.followUpDate ?? null, input.notes ?? null],
    );
    await tx.query(
      `INSERT INTO lead_activities (tenant_id, lead_id, kind, detail, actor_id)
       VALUES ($1,$2,'status_change',$3,$4)`,
      [user.tenantId, input.id, input.status, user.userId],
    );
  });
}

/** Mark a lead as converted once the member record is created. */
export async function markLeadConverted(
  user: SessionUser,
  leadId: string,
  memberId: string,
): Promise<void> {
  return asPrincipal(user.claims, async (tx) => {
    await tx.query(`UPDATE leads SET status = 'won', converted_member_id = $2 WHERE id = $1`, [
      leadId,
      memberId,
    ]);
    await writeAudit(tx, user, {
      action: 'lead.convert',
      entityType: 'lead',
      entityId: leadId,
      after: { memberId },
    });
  });
}
