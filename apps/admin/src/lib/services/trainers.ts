import 'server-only';
import { asPrincipal } from '../db';
import { writeAudit } from '../audit';
import type { SessionUser } from '../session';

export interface TrainerRow {
  id: string;
  name: string;
  mobile: string;
  specialization: string | null;
  branch_name: string;
  is_active: boolean;
  assigned_members: number;
  upcoming_sessions: number;
}

export async function listTrainers(user: SessionUser): Promise<TrainerRow[]> {
  return asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(
      `SELECT t.id, t.name, t.mobile, t.specialization, b.name AS branch_name, t.is_active,
              (SELECT count(*)::int FROM members m WHERE m.assigned_trainer_id = t.id
                 AND m.archived_at IS NULL) AS assigned_members,
              (SELECT count(*)::int FROM trainer_sessions ts WHERE ts.trainer_id = t.id
                 AND ts.status = 'scheduled' AND ts.session_date >= CURRENT_DATE) AS upcoming_sessions
       FROM trainers t JOIN branches b ON b.id = t.branch_id
       ORDER BY t.is_active DESC, t.name`,
    );
    return r.rows as TrainerRow[];
  });
}

export async function createTrainer(
  user: SessionUser,
  input: { branchId: string; name: string; mobile: string; specialization?: string | null },
): Promise<string> {
  return asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(
      `INSERT INTO trainers (tenant_id, branch_id, name, mobile, specialization)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [user.tenantId, input.branchId, input.name, input.mobile, input.specialization ?? null],
    );
    const id = (r.rows[0] as { id: string }).id;
    await writeAudit(tx, user, {
      action: 'trainer.create',
      entityType: 'trainer',
      entityId: id,
      after: { name: input.name },
    });
    return id;
  });
}

export async function setTrainerActive(
  user: SessionUser,
  trainerId: string,
  active: boolean,
): Promise<void> {
  return asPrincipal(user.claims, async (tx) => {
    await tx.query(`UPDATE trainers SET is_active = $2 WHERE id = $1`, [trainerId, active]);
    await writeAudit(tx, user, {
      action: active ? 'trainer.activate' : 'trainer.deactivate',
      entityType: 'trainer',
      entityId: trainerId,
    });
  });
}
