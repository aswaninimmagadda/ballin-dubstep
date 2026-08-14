import 'server-only';
import type { CreatePlanInput } from '@gymflow/validation';
import { asPrincipal } from '../db';
import { writeAudit } from '../audit';
import { UserFacingError } from '../errors';
import type { SessionUser } from '../session';

export interface PlanRow {
  id: string;
  name: string;
  public_description: string | null;
  is_active: boolean;
  display_order: number;
  duration_unit: 'days' | 'months';
  duration_value: number;
  base_price: string;
  joining_fee: string;
  grace_period_days: number;
  version: number;
}

export async function listPlans(user: SessionUser, includeInactive = false): Promise<PlanRow[]> {
  return asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(
      `SELECT p.id, p.name, p.public_description, p.is_active, p.display_order,
              v.duration_unit, v.duration_value, v.base_price::bigint::text AS base_price,
              v.joining_fee::bigint::text AS joining_fee, v.grace_period_days, v.version
       FROM membership_plans p
       JOIN LATERAL (
         SELECT * FROM membership_plan_versions WHERE plan_id = p.id ORDER BY version DESC LIMIT 1
       ) v ON true
       ${includeInactive ? '' : 'WHERE p.is_active'}
       ORDER BY p.display_order, p.name`,
    );
    return r.rows as PlanRow[];
  });
}

export async function createPlan(user: SessionUser, input: CreatePlanInput): Promise<string> {
  return asPrincipal(user.claims, async (tx) => {
    const pR = await tx.query(
      `INSERT INTO membership_plans (tenant_id, name, public_description, internal_description,
                                     display_order, tags, effective_from, effective_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        user.tenantId, input.name, input.publicDescription ?? null,
        input.internalDescription ?? null, input.displayOrder, input.tags,
        input.effectiveFrom ?? null, input.effectiveTo ?? null,
      ],
    );
    const planId = (pR.rows[0] as { id: string }).id;
    await insertVersion(tx, user.tenantId!, planId, 1, input.terms);
    await writeAudit(tx, user, {
      action: 'plan.create', entityType: 'membership_plan', entityId: planId,
      after: { name: input.name, basePrice: input.terms.basePrice },
    });
    return planId;
  });
}

/** Changing terms creates a NEW version — historical sales keep the old one. */
export async function updatePlanTerms(
  user: SessionUser,
  planId: string,
  terms: CreatePlanInput['terms'],
): Promise<number> {
  return asPrincipal(user.claims, async (tx) => {
    const vR = await tx.query(
      `SELECT coalesce(max(version), 0)::int AS v FROM membership_plan_versions WHERE plan_id = $1`,
      [planId],
    );
    const current = (vR.rows[0] as { v: number }).v;
    if (current === 0) throw new UserFacingError('Plan not found.');
    const next = current + 1;
    await insertVersion(tx, user.tenantId!, planId, next, terms);
    await writeAudit(tx, user, {
      action: 'plan.update_terms', entityType: 'membership_plan', entityId: planId,
      after: { version: next, basePrice: terms.basePrice },
    });
    return next;
  });
}

export async function setPlanActive(user: SessionUser, planId: string, active: boolean): Promise<void> {
  return asPrincipal(user.claims, async (tx) => {
    await tx.query(`UPDATE membership_plans SET is_active = $2 WHERE id = $1`, [planId, active]);
    await writeAudit(tx, user, {
      action: active ? 'plan.activate' : 'plan.deactivate',
      entityType: 'membership_plan', entityId: planId,
    });
  });
}

async function insertVersion(
  tx: { query: (q: string, p?: unknown[]) => Promise<unknown> },
  tenantId: string,
  planId: string,
  version: number,
  terms: CreatePlanInput['terms'],
): Promise<void> {
  await tx.query(
    `INSERT INTO membership_plan_versions
      (tenant_id, plan_id, version, duration_unit, duration_value, base_price, joining_fee,
       tax_rate_bps, tax_inclusive, freeze_allowance_days, max_freezes, grace_period_days,
       allowed_timings, max_visits_per_month, branch_ids, eligibility_note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      tenantId, planId, version, terms.durationUnit, terms.durationValue,
      terms.basePrice, terms.joiningFee, terms.taxRateBps, terms.taxInclusive,
      terms.freezeAllowanceDays, terms.maxFreezes, terms.gracePeriodDays,
      terms.allowedTimings ?? null, terms.maxVisitsPerMonth ?? null,
      terms.branchIds ?? null, terms.eligibilityNote ?? null,
    ],
  );
}
