import 'server-only';
import {
  computeEndDate,
  proposeRenewal,
  quoteMembership,
  checkPromotionEligibility,
  fiscalYearLabel,
  formatReceiptNumber,
  freezeExtensionDays,
  applyFreezeExtension,
  type MembershipQuote,
} from '@gymflow/core';
import { todayInTz, maxDate, formatMoney } from '@gymflow/utils';
import type { SellMembershipInput, RenewMembershipInput } from '@gymflow/validation';
import { asPrincipal, type Queryable } from '../db';
import { writeAudit } from '../audit';
import { UserFacingError } from '../errors';
import { queueMemberNotification } from './notifications';
import type { SessionUser } from '../session';

interface PlanVersionRow {
  id: string;
  plan_id: string;
  duration_unit: 'days' | 'months';
  duration_value: number;
  base_price: number;
  joining_fee: number;
  tax_rate_bps: number;
  tax_inclusive: boolean;
  grace_period_days: number;
  plan_name: string;
}

async function latestPlanVersion(tx: Queryable, planId: string): Promise<PlanVersionRow> {
  const r = await tx.query(
    `SELECT v.id, v.plan_id, v.duration_unit, v.duration_value,
            v.base_price::bigint AS base_price, v.joining_fee::bigint AS joining_fee,
            v.tax_rate_bps, v.tax_inclusive, v.grace_period_days, p.name AS plan_name
     FROM membership_plan_versions v
     JOIN membership_plans p ON p.id = v.plan_id
     WHERE v.plan_id = $1 AND p.is_active
     ORDER BY v.version DESC LIMIT 1`,
    [planId],
  );
  const row = r.rows[0] as PlanVersionRow | undefined;
  if (!row) throw new UserFacingError('This plan is not available any more. Choose another plan.');
  return { ...row, base_price: Number(row.base_price), joining_fee: Number(row.joining_fee) };
}

interface PromotionRow {
  id: string;
  discount_kind: 'percentage' | 'flat' | 'joining_fee_waiver';
  discount_value: number;
  max_discount_amount: number | null;
  is_active: boolean;
  valid_from: string;
  valid_to: string;
  plan_ids: string[] | null;
  branch_ids: string[] | null;
  audience: 'all' | 'new_members' | 'renewals' | 'win_back';
  usage_limit: number | null;
  per_member_limit: number | null;
}

async function resolvePromotion(
  tx: Queryable,
  opts: {
    code: string;
    planId: string;
    branchId: string;
    memberId: string;
    isRenewal: boolean;
    today: string;
  },
): Promise<PromotionRow> {
  const r = await tx.query(
    `SELECT id, discount_kind, discount_value::bigint AS discount_value,
            max_discount_amount::bigint AS max_discount_amount, is_active,
            valid_from::text AS valid_from, valid_to::text AS valid_to,
            plan_ids, branch_ids, audience, usage_limit, per_member_limit
     FROM promotions WHERE code = upper($1)`,
    [opts.code],
  );
  const promo = r.rows[0] as PromotionRow | undefined;
  if (!promo) throw new UserFacingError('Promotion code not found.');
  const counts = await tx.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE member_id = $2)::int AS by_member
     FROM promotion_redemptions WHERE promotion_id = $1`,
    [promo.id, opts.memberId],
  );
  const { total, by_member } = counts.rows[0] as { total: number; by_member: number };
  const result = checkPromotionEligibility(
    {
      isActive: promo.is_active,
      validFrom: promo.valid_from,
      validTo: promo.valid_to,
      planIds: promo.plan_ids,
      branchIds: promo.branch_ids,
      audience: promo.audience,
      usageLimit: promo.usage_limit,
      perMemberLimit: promo.per_member_limit,
    },
    {
      today: opts.today,
      planId: opts.planId,
      branchId: opts.branchId,
      isRenewal: opts.isRenewal,
      isNewMember: !opts.isRenewal,
      memberRedemptionCount: by_member,
      totalRedemptionCount: total,
    },
  );
  if (!result.eligible) {
    const reasons: Record<string, string> = {
      inactive: 'This promotion is no longer active.',
      not_started: 'This promotion has not started yet.',
      ended: 'This promotion has ended.',
      plan_not_applicable: 'This promotion does not apply to the selected plan.',
      branch_not_applicable: 'This promotion does not apply to this branch.',
      audience_mismatch: 'This member is not eligible for this promotion.',
      usage_limit_reached: 'This promotion has reached its usage limit.',
      per_member_limit_reached: 'This member has already used this promotion.',
    };
    throw new UserFacingError(reasons[result.reason ?? ''] ?? 'Promotion is not applicable.');
  }
  return {
    ...promo,
    discount_value: Number(promo.discount_value),
    max_discount_amount:
      promo.max_discount_amount == null ? null : Number(promo.max_discount_amount),
  };
}

/**
 * Manual discounts above the tenant's approval threshold require the
 * discounts.approve permission. Promotion discounts are exempt — a
 * promotion's value was already authorized when it was configured.
 */
async function assertManualDiscountAuthorized(
  tx: Queryable,
  user: SessionUser,
  manualDiscount: number | undefined,
  subtotal: number,
): Promise<void> {
  if (!manualDiscount || manualDiscount <= 0 || subtotal <= 0) return;
  const sR = await tx.query(
    `SELECT discount_approval_threshold_bps FROM gym_settings WHERE tenant_id = $1`,
    [user.tenantId],
  );
  const threshold = Number(
    (sR.rows[0] as { discount_approval_threshold_bps: number } | undefined)
      ?.discount_approval_threshold_bps ?? 0,
  );
  const bps = Math.floor((Math.min(manualDiscount, subtotal) * 10000) / subtotal);
  if (bps > threshold && !user.permissions.has('discounts.approve')) {
    throw new UserFacingError(
      'This discount is above the approval limit. A manager must apply it.',
    );
  }
}

/**
 * A membership that isn't paid in full leaves the gym carrying a receivable,
 * so it is only allowed where the tenant has turned part payments on.
 */
async function assertPartialPaymentAllowed(
  tx: Queryable,
  user: SessionUser,
  amountDue: number,
): Promise<void> {
  const r = await tx.query(`SELECT allow_partial_payments FROM gym_settings WHERE tenant_id = $1`, [
    user.tenantId,
  ]);
  const allowed = (r.rows[0] as { allow_partial_payments: boolean } | undefined)
    ?.allow_partial_payments;
  if (!allowed) {
    throw new UserFacingError(
      `Partial payments are not enabled for this gym. Collect the full ${formatMoney(amountDue)}, or turn on part payments in Settings.`,
    );
  }
}

async function recordPaymentWithReceipt(
  tx: Queryable,
  user: SessionUser,
  opts: {
    branchId: string;
    memberId: string;
    membershipId?: string | null;
    memberAddonId?: string | null;
    amount: number;
    method: string;
    externalReference?: string | null;
    paymentDate: string;
    idempotencyKey: string;
  },
): Promise<{ paymentId: string; receiptNumber: string }> {
  const pr = await tx.query(
    `INSERT INTO payments (tenant_id, branch_id, member_id, amount, method, payment_date,
                           external_reference, received_by, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [
      user.tenantId,
      opts.branchId,
      opts.memberId,
      opts.amount,
      opts.method,
      opts.paymentDate,
      opts.externalReference ?? null,
      user.userId,
      opts.idempotencyKey,
    ],
  );
  const paymentId = (pr.rows[0] as { id: string }).id;
  if (opts.membershipId || opts.memberAddonId) {
    await tx.query(
      `INSERT INTO payment_allocations (tenant_id, payment_id, membership_id, member_addon_id, amount)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        user.tenantId,
        paymentId,
        opts.membershipId ?? null,
        opts.memberAddonId ?? null,
        opts.amount,
      ],
    );
  }
  const settings = await tx.query(
    `SELECT receipt_prefix, receipt_sequence_padding FROM gym_settings WHERE tenant_id = $1`,
    [user.tenantId],
  );
  const s = settings.rows[0] as { receipt_prefix: string; receipt_sequence_padding: number };
  const fy = fiscalYearLabel(opts.paymentDate);
  const seqR = await tx.query(`SELECT app.next_receipt_seq($1, $2) AS seq`, [user.tenantId, fy]);
  const seq = Number((seqR.rows[0] as { seq: string }).seq);
  const receiptNumber = formatReceiptNumber({
    prefix: s.receipt_prefix,
    fiscalYear: fy,
    sequence: seq,
    padding: s.receipt_sequence_padding,
  });
  await tx.query(
    `INSERT INTO receipts (tenant_id, branch_id, payment_id, receipt_number, sequence, fiscal_year)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [user.tenantId, opts.branchId, paymentId, receiptNumber, seq, fy],
  );
  return { paymentId, receiptNumber };
}

export interface SaleResult {
  membershipId: string;
  startDate: string;
  endDate: string;
  quote: MembershipQuote;
  receiptNumber: string | null;
}

/** Sell a new membership (optionally with immediate payment + receipt). */
export async function sellMembership(
  user: SessionUser,
  input: SellMembershipInput,
): Promise<SaleResult> {
  const today = todayInTz();
  return asPrincipal(user.claims, async (tx) => {
    const member = await tx.query(`SELECT id, branch_id, status FROM members WHERE id = $1`, [
      input.memberId,
    ]);
    const m = member.rows[0] as { id: string; branch_id: string; status: string } | undefined;
    if (!m) throw new UserFacingError('Member not found.');

    const pv = await latestPlanVersion(tx, input.planId);
    const promo = input.promotionCode
      ? await resolvePromotion(tx, {
          code: input.promotionCode,
          planId: input.planId,
          branchId: m.branch_id,
          memberId: m.id,
          isRenewal: false,
          today,
        })
      : null;

    const quote = quoteMembership({
      planVersion: {
        basePrice: pv.base_price,
        joiningFee: pv.joining_fee,
        taxRateBps: pv.tax_rate_bps,
        taxInclusive: pv.tax_inclusive,
      },
      planName: pv.plan_name,
      includeJoiningFee: input.includeJoiningFee,
      promotion: promo
        ? {
            discountKind: promo.discount_kind,
            discountValue: promo.discount_value,
            maxDiscountAmount: promo.max_discount_amount,
          }
        : null,
      manualDiscount: input.manualDiscount,
    });
    await assertManualDiscountAuthorized(tx, user, input.manualDiscount, quote.subtotal);

    const endDate = computeEndDate({
      startDate: input.startDate,
      durationUnit: pv.duration_unit,
      durationValue: pv.duration_value,
    });
    const state = input.startDate > today ? 'pending' : 'active';

    const msR = await tx.query(
      `INSERT INTO memberships
        (tenant_id, branch_id, member_id, plan_id, plan_version_id, plan_name_snapshot,
         start_date, base_end_date, end_date, grace_period_days, state, total_amount,
         discount_amount, promotion_id, sold_by, idempotency_key,
         tax_amount, tax_rate_bps)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
      [
        user.tenantId,
        m.branch_id,
        m.id,
        input.planId,
        pv.id,
        pv.plan_name,
        input.startDate,
        endDate,
        pv.grace_period_days,
        state,
        quote.total,
        quote.discount,
        promo?.id ?? null,
        user.userId,
        input.idempotencyKey,
        // frozen at sale time: raising the plan's rate later must not rewrite
        // a receipt that has already been handed to a member
        quote.tax,
        pv.tax_rate_bps,
      ],
    );
    const membershipId = (msR.rows[0] as { id: string }).id;

    await tx.query(
      `INSERT INTO membership_events (tenant_id, membership_id, type, data, actor_id)
       VALUES ($1,$2,'sold',$3,$4)`,
      [
        user.tenantId,
        membershipId,
        JSON.stringify({ total: quote.total, plan: pv.plan_name }),
        user.userId,
      ],
    );
    if (promo) {
      await tx.query(
        `INSERT INTO promotion_redemptions (tenant_id, promotion_id, member_id, membership_id, discount_amount)
         VALUES ($1,$2,$3,$4,$5)`,
        [user.tenantId, promo.id, m.id, membershipId, quote.discount],
      );
    }
    if (state === 'active') {
      await tx.query(`UPDATE members SET status = 'active' WHERE id = $1`, [m.id]);
    } else {
      // Future-dated sale: don't downgrade a member whose current membership
      // is still running (early add-on sale alongside an active one).
      await tx.query(
        `UPDATE members SET status = 'pending_activation'
         WHERE id = $1 AND status NOT IN ('active','frozen')`,
        [m.id],
      );
    }

    let receiptNumber: string | null = null;
    {
      // Taking nothing is a 100% part payment — it leaves the gym owed the
      // whole fee — so it goes through the same gate as an under-payment
      // rather than slipping past it because no payment object was sent.
      const paid = input.payment?.amount ?? 0;
      if (paid > quote.total) {
        throw new UserFacingError(
          `Payment is more than the amount due. Collect ${formatMoney(quote.total)}.`,
        );
      }
      if (paid < quote.total) {
        await assertPartialPaymentAllowed(tx, user, quote.total);
      }
    }
    if (input.payment) {
      if (input.payment.amount > 0) {
        const rec = await recordPaymentWithReceipt(tx, user, {
          branchId: m.branch_id,
          memberId: m.id,
          membershipId,
          amount: input.payment.amount,
          method: input.payment.method,
          externalReference: input.payment.externalReference,
          paymentDate: input.payment.paymentDate ?? today,
          idempotencyKey: `${input.idempotencyKey}:payment`,
        });
        receiptNumber = rec.receiptNumber;
      }
    }

    await writeAudit(tx, user, {
      action: 'membership.sell',
      entityType: 'membership',
      entityId: membershipId,
      after: { plan: pv.plan_name, startDate: input.startDate, endDate, total: quote.total },
    });
    return { membershipId, startDate: input.startDate, endDate, quote, receiptNumber };
  });
}

/** Renew: new membership row chained to the previous one. */
export async function renewMembership(
  user: SessionUser,
  input: RenewMembershipInput,
): Promise<SaleResult> {
  const today = todayInTz();
  return asPrincipal(user.claims, async (tx) => {
    const prevR = await tx.query(
      `SELECT id, member_id, branch_id, end_date::text AS end_date, state
       FROM memberships WHERE id = $1`,
      [input.previousMembershipId],
    );
    const prev = prevR.rows[0] as
      | { id: string; member_id: string; branch_id: string; end_date: string; state: string }
      | undefined;
    if (!prev) throw new UserFacingError('Previous membership not found.');
    if (prev.member_id !== input.memberId)
      throw new UserFacingError('Membership does not belong to this member.');
    if (['pending', 'frozen'].includes(prev.state)) {
      throw new UserFacingError('This membership cannot be renewed while it is pending or frozen.');
    }

    const pv = await latestPlanVersion(tx, input.planId);
    const proposal = proposeRenewal({
      currentEndDate: prev.end_date,
      today,
      durationUnit: pv.duration_unit,
      durationValue: pv.duration_value,
      overrideStartDate: input.overrideStartDate,
    });

    // A lapsed membership is closed out now; one still running stays active
    // until its own end date — the renewal sits alongside as 'pending'.
    if (prev.state === 'active') {
      await tx.query(`UPDATE memberships SET state = 'expired' WHERE id = $1 AND end_date < $2`, [
        prev.id,
        today,
      ]);
    }

    const promo = input.promotionCode
      ? await resolvePromotion(tx, {
          code: input.promotionCode,
          planId: input.planId,
          branchId: prev.branch_id,
          memberId: prev.member_id,
          isRenewal: true,
          today,
        })
      : null;

    const quote = quoteMembership({
      planVersion: {
        basePrice: pv.base_price,
        joiningFee: pv.joining_fee,
        taxRateBps: pv.tax_rate_bps,
        taxInclusive: pv.tax_inclusive,
      },
      planName: pv.plan_name,
      includeJoiningFee: false, // renewals never re-charge the joining fee
      promotion: promo
        ? {
            discountKind: promo.discount_kind,
            discountValue: promo.discount_value,
            maxDiscountAmount: promo.max_discount_amount,
          }
        : null,
      manualDiscount: input.manualDiscount,
    });
    await assertManualDiscountAuthorized(tx, user, input.manualDiscount, quote.subtotal);

    const state = proposal.startDate > today ? 'pending' : 'active';
    const msR = await tx.query(
      `INSERT INTO memberships
        (tenant_id, branch_id, member_id, plan_id, plan_version_id, plan_name_snapshot,
         start_date, base_end_date, end_date, grace_period_days, state, total_amount,
         discount_amount, promotion_id, sold_by, previous_membership_id, idempotency_key,
         tax_amount, tax_rate_bps)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
      [
        user.tenantId,
        prev.branch_id,
        prev.member_id,
        input.planId,
        pv.id,
        pv.plan_name,
        proposal.startDate,
        proposal.endDate,
        pv.grace_period_days,
        state,
        quote.total,
        quote.discount,
        promo?.id ?? null,
        user.userId,
        prev.id,
        input.idempotencyKey,
        quote.tax,
        pv.tax_rate_bps,
      ],
    );
    const membershipId = (msR.rows[0] as { id: string }).id;
    await tx.query(
      `INSERT INTO membership_events (tenant_id, membership_id, type, data, actor_id)
       VALUES ($1,$2,'renewed',$3,$4)`,
      [
        user.tenantId,
        membershipId,
        JSON.stringify({ from: prev.id, total: quote.total }),
        user.userId,
      ],
    );
    if (promo) {
      await tx.query(
        `INSERT INTO promotion_redemptions (tenant_id, promotion_id, member_id, membership_id, discount_amount)
         VALUES ($1,$2,$3,$4,$5)`,
        [user.tenantId, promo.id, prev.member_id, membershipId, quote.discount],
      );
    }
    await tx.query(
      `UPDATE members SET status = 'active' WHERE id = $1 AND status IN ('expired','pending_activation')`,
      [prev.member_id],
    );

    let receiptNumber: string | null = null;
    {
      // Same rule as a new sale: anything short of the full fee — including
      // taking nothing today — needs part payments to be enabled.
      const paid = input.payment?.amount ?? 0;
      if (paid > quote.total) {
        throw new UserFacingError(
          `Payment is more than the amount due. Collect ${formatMoney(quote.total)}.`,
        );
      }
      if (paid < quote.total) {
        await assertPartialPaymentAllowed(tx, user, quote.total);
      }
    }
    if (input.payment && input.payment.amount > 0) {
      const rec = await recordPaymentWithReceipt(tx, user, {
        branchId: prev.branch_id,
        memberId: prev.member_id,
        membershipId,
        amount: input.payment.amount,
        method: input.payment.method,
        externalReference: input.payment.externalReference,
        paymentDate: input.payment.paymentDate ?? today,
        idempotencyKey: `${input.idempotencyKey}:payment`,
      });
      receiptNumber = rec.receiptNumber;
    }

    await queueMemberNotification(tx, user, {
      memberId: prev.member_id,
      event: 'renewal_completed',
      dedupeKey: `renewal:${membershipId}`,
      body: `${pv.plan_name} renewed: ${proposal.startDate} to ${proposal.endDate}.`,
    });
    await writeAudit(tx, user, {
      action: 'membership.renew',
      entityType: 'membership',
      entityId: membershipId,
      after: { plan: pv.plan_name, ...proposal, total: quote.total },
    });
    return { membershipId, ...proposal, quote, receiptNumber };
  });
}

/** Cancel a membership (manager+). The row is never deleted. */
export async function cancelMembership(
  user: SessionUser,
  input: { membershipId: string; reason: string },
): Promise<void> {
  const today = todayInTz();
  return asPrincipal(user.claims, async (tx) => {
    const msR = await tx.query(`SELECT id, member_id, state FROM memberships WHERE id = $1`, [
      input.membershipId,
    ]);
    const ms = msR.rows[0] as { id: string; member_id: string; state: string } | undefined;
    if (!ms) throw new UserFacingError('Membership not found.');
    if (!['pending', 'active', 'frozen'].includes(ms.state)) {
      throw new UserFacingError('Only a pending, active or frozen membership can be cancelled.');
    }
    await tx.query(
      `UPDATE memberships SET state = 'cancelled', cancelled_at = now(), cancel_reason = $2
       WHERE id = $1`,
      [ms.id, input.reason],
    );
    // Close any open freeze so history stays consistent (tenant calendar day,
    // not the server's UTC day).
    await tx.query(
      `UPDATE membership_freezes SET actual_end_date = GREATEST($2::date, start_date),
              days = GREATEST(($2::date - start_date)::int, 1)
       WHERE membership_id = $1 AND actual_end_date IS NULL`,
      [ms.id, today],
    );
    // The member is only 'cancelled' when nothing else is live — cancelling a
    // running membership must not orphan a paid pending renewal (or vice versa).
    const liveR = await tx.query(
      `SELECT state FROM memberships
       WHERE member_id = $1 AND id <> $2 AND state IN ('active','frozen','pending')`,
      [ms.member_id, ms.id],
    );
    const liveStates = new Set(liveR.rows.map((r) => (r as { state: string }).state));
    const newStatus = liveStates.has('active')
      ? 'active'
      : liveStates.has('frozen')
        ? 'frozen'
        : liveStates.has('pending')
          ? 'pending_activation'
          : 'cancelled';
    await tx.query(
      `UPDATE members SET status = $2 WHERE id = $1 AND status IN ('active','frozen','pending_activation')`,
      [ms.member_id, newStatus],
    );
    await tx.query(
      `INSERT INTO membership_events (tenant_id, membership_id, type, data, actor_id)
       VALUES ($1,$2,'cancelled',$3,$4)`,
      [user.tenantId, ms.id, JSON.stringify({ reason: input.reason }), user.userId],
    );
    await writeAudit(tx, user, {
      action: 'membership.cancel',
      entityType: 'membership',
      entityId: ms.id,
      after: { reason: input.reason },
    });
  });
}

export async function freezeMembership(
  user: SessionUser,
  input: {
    membershipId: string;
    startDate: string;
    plannedEndDate?: string | null;
    reason: string;
    note?: string | null;
    extendsExpiry: boolean;
  },
): Promise<void> {
  return asPrincipal(user.claims, async (tx) => {
    const msR = await tx.query(`SELECT id, member_id, state FROM memberships WHERE id = $1`, [
      input.membershipId,
    ]);
    const ms = msR.rows[0] as { id: string; member_id: string; state: string } | undefined;
    if (!ms) throw new UserFacingError('Membership not found.');
    if (ms.state !== 'active')
      throw new UserFacingError('Only an active membership can be frozen.');

    // Enforce the tenant's freeze rules over the trailing 12 months.
    const limitsR = await tx.query(
      `SELECT gs.max_freezes_per_year, gs.max_freeze_days_per_year,
              count(f.id)::int AS used_freezes,
              coalesce(sum(coalesce(f.days,
                GREATEST((coalesce(f.actual_end_date, f.planned_end_date, f.start_date) - f.start_date), 1)
              )), 0)::int AS used_days
       FROM gym_settings gs
       LEFT JOIN membership_freezes f
         ON f.tenant_id = gs.tenant_id
        AND f.start_date > CURRENT_DATE - 365
        AND f.membership_id IN (SELECT id FROM memberships WHERE member_id = $2)
       WHERE gs.tenant_id = $1
       GROUP BY gs.max_freezes_per_year, gs.max_freeze_days_per_year`,
      [user.tenantId, ms.member_id],
    );
    const limits = limitsR.rows[0] as
      | {
          max_freezes_per_year: number;
          max_freeze_days_per_year: number;
          used_freezes: number;
          used_days: number;
        }
      | undefined;
    if (limits) {
      if (limits.used_freezes >= limits.max_freezes_per_year) {
        throw new UserFacingError(
          `This member already used ${limits.used_freezes} of ${limits.max_freezes_per_year} freezes this year (Settings → freeze rules).`,
        );
      }
      const plannedDays = input.plannedEndDate
        ? freezeExtensionDays(input.startDate, input.plannedEndDate)
        : 0;
      if (limits.used_days + plannedDays > limits.max_freeze_days_per_year) {
        throw new UserFacingError(
          `This freeze would exceed the yearly limit of ${limits.max_freeze_days_per_year} frozen days (${limits.used_days} already used).`,
        );
      }
    }

    await tx.query(
      `INSERT INTO membership_freezes
        (tenant_id, membership_id, start_date, planned_end_date, reason, note, extends_expiry, authorized_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        user.tenantId,
        ms.id,
        input.startDate,
        input.plannedEndDate ?? null,
        input.reason,
        input.note ?? null,
        input.extendsExpiry,
        user.userId,
      ],
    );
    await tx.query(`UPDATE memberships SET state = 'frozen' WHERE id = $1`, [ms.id]);
    await tx.query(`UPDATE members SET status = 'frozen' WHERE id = $1`, [ms.member_id]);
    await tx.query(
      `INSERT INTO membership_events (tenant_id, membership_id, type, data, actor_id)
       VALUES ($1,$2,'frozen',$3,$4)`,
      [
        user.tenantId,
        ms.id,
        JSON.stringify({ reason: input.reason, start: input.startDate }),
        user.userId,
      ],
    );
    await writeAudit(tx, user, {
      action: 'membership.freeze',
      entityType: 'membership',
      entityId: ms.id,
      after: { startDate: input.startDate, reason: input.reason },
    });
  });
}

export async function unfreezeMembership(
  user: SessionUser,
  input: { membershipId: string; actualEndDate: string },
): Promise<{ newEndDate: string }> {
  return asPrincipal(user.claims, async (tx) => {
    const fR = await tx.query(
      `SELECT f.id, f.start_date::text AS start_date, f.extends_expiry,
              m.end_date::text AS end_date, m.member_id
       FROM membership_freezes f JOIN memberships m ON m.id = f.membership_id
       WHERE f.membership_id = $1 AND f.actual_end_date IS NULL`,
      [input.membershipId],
    );
    const f = fR.rows[0] as
      | {
          id: string;
          start_date: string;
          extends_expiry: boolean;
          end_date: string;
          member_id: string;
        }
      | undefined;
    if (!f) throw new UserFacingError('No open freeze found for this membership.');
    const actualEnd = maxDate(input.actualEndDate, f.start_date);
    const days = freezeExtensionDays(f.start_date, actualEnd);
    const newEndDate = f.extends_expiry ? applyFreezeExtension(f.end_date, days) : f.end_date;

    await tx.query(`UPDATE membership_freezes SET actual_end_date = $2, days = $3 WHERE id = $1`, [
      f.id,
      actualEnd,
      days,
    ]);
    await tx.query(`UPDATE memberships SET state = 'active', end_date = $2 WHERE id = $1`, [
      input.membershipId,
      newEndDate,
    ]);
    await tx.query(`UPDATE members SET status = 'active' WHERE id = $1`, [f.member_id]);
    await tx.query(
      `INSERT INTO membership_events (tenant_id, membership_id, type, data, actor_id)
       VALUES ($1,$2,'unfrozen',$3,$4)`,
      [user.tenantId, input.membershipId, JSON.stringify({ days, newEndDate }), user.userId],
    );
    await writeAudit(tx, user, {
      action: 'membership.unfreeze',
      entityType: 'membership',
      entityId: input.membershipId,
      after: { days, newEndDate },
    });
    return { newEndDate };
  });
}
