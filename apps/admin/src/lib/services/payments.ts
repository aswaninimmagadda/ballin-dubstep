import 'server-only';
import { fiscalYearLabel, formatReceiptNumber } from '@gymflow/core';
import { formatMoney, todayInTz } from '@gymflow/utils';
import type { RecordPaymentInput } from '@gymflow/validation';
import { asPrincipal } from '../db';
import { DUE_ON_MEMBERSHIP } from './money-sql';
import { writeAudit } from '../audit';
import { UserFacingError } from '../errors';
import { queueMemberNotification } from './notifications';
import type { SessionUser } from '../session';

/**
 * How far back a payment may be dated.
 *
 * The receipt's financial-year label — and therefore its permanent receipt
 * number — comes from this date, so a slipped year on the date field mints a
 * receipt in a closed financial year that can never be corrected, because
 * receipts are append-only. Late entry of a few weeks is normal at a gym
 * desk; a date from last year is always a typo.
 */
export const MAX_BACKDATE_DAYS = 30;

/**
 * The earliest date a payment may carry: 30 days back, but never before the
 * start of the current financial year (1 April), because a receipt written
 * into a closed year cannot be corrected.
 */
export function earliestPaymentDate(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - MAX_BACKDATE_DAYS);
  const window = d.toISOString().slice(0, 10);
  const fyStart = `${fiscalYearLabel(today).slice(0, 4)}-04-01`;
  return window > fyStart ? window : fyStart;
}

function assertPaymentDateInRange(paymentDate: string, today: string): void {
  if (paymentDate > today) {
    throw new UserFacingError('A payment cannot be dated in the future.');
  }
  const earliestIso = earliestPaymentDate(today);
  if (paymentDate < earliestIso) {
    throw new UserFacingError(
      `A payment cannot be dated more than ${MAX_BACKDATE_DAYS} days ago (earliest ${earliestIso}). Check the year.`,
    );
  }
  // The 30-day window is not enough on its own: entered on 10 April, 25 March
  // is only 16 days back but lands in the PREVIOUS financial year, and the
  // receipt number it mints there is append-only. Every April the books are
  // closed behind you, so a cross-year date has to be a deliberate decision
  // taken with the accountant, not a side effect of a date picker.
  if (fiscalYearLabel(paymentDate) !== fiscalYearLabel(today)) {
    throw new UserFacingError(
      `That date falls in financial year ${fiscalYearLabel(paymentDate)}, which is closed. ` +
        `Receipts cannot be added to a closed year — record it in ${fiscalYearLabel(today)} ` +
        'and note the original date, or ask your accountant.',
    );
  }
}

export async function recordPayment(
  user: SessionUser,
  input: RecordPaymentInput,
): Promise<{ paymentId: string; receiptNumber: string }> {
  const today = todayInTz();
  const paymentDate = input.paymentDate ?? today;
  assertPaymentDateInRange(paymentDate, today);
  return asPrincipal(user.claims, async (tx) => {
    const mR = await tx.query(`SELECT id, branch_id FROM members WHERE id = $1`, [input.memberId]);
    const m = mR.rows[0] as { id: string; branch_id: string } | undefined;
    if (!m) throw new UserFacingError('Member not found.');

    // A payment aimed at a membership cannot exceed what is still owed on it.
    // Selling and renewing already refuse an overpayment; this path did not,
    // so a slipped digit at the desk wrote a payment the drawer would never
    // reconcile and drove the dues figure negative — which the member page
    // then hid, because it only renders dues when the balance is positive.
    if (input.membershipId) {
      // Lock the membership first. Reading the balance and then inserting
      // against it is a check-then-act, and under READ COMMITTED two
      // receptionists collecting the last part payment at the same moment
      // both read the same outstanding figure and both write. The refund path
      // already takes this lock; this one has to as well.
      const lockR = await tx.query(`SELECT id FROM memberships WHERE id = $1 FOR UPDATE`, [
        input.membershipId,
      ]);
      if ((lockR as { rowCount: number }).rowCount === 0) {
        throw new UserFacingError('Membership not found.');
      }
      const dR = await tx.query(
        `SELECT ${DUE_ON_MEMBERSHIP}::bigint::text AS due FROM memberships ms WHERE ms.id = $1`,
        [input.membershipId],
      );
      const dueRow = dR.rows[0] as { due: string } | undefined;
      if (!dueRow) throw new UserFacingError('Membership not found.');
      const due = Number(dueRow.due);
      if (input.amount > due) {
        throw new UserFacingError(
          due <= 0
            ? 'This membership is already paid in full.'
            : `Payment is more than the amount due. Collect ${formatMoney(due)}.`,
        );
      }
    }

    const pr = await tx.query(
      `INSERT INTO payments (tenant_id, branch_id, member_id, amount, method, payment_date,
                             external_reference, received_by, notes, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        user.tenantId,
        m.branch_id,
        m.id,
        input.amount,
        input.method,
        paymentDate,
        input.externalReference ?? null,
        user.userId,
        input.notes ?? null,
        input.idempotencyKey,
      ],
    );
    const paymentId = (pr.rows[0] as { id: string }).id;

    if (input.membershipId || input.memberAddonId) {
      await tx.query(
        `INSERT INTO payment_allocations (tenant_id, payment_id, membership_id, member_addon_id, amount)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          user.tenantId,
          paymentId,
          input.membershipId ?? null,
          input.memberAddonId ?? null,
          input.amount,
        ],
      );
    }

    const sR = await tx.query(
      `SELECT receipt_prefix, receipt_sequence_padding FROM gym_settings WHERE tenant_id = $1`,
      [user.tenantId],
    );
    const s = sR.rows[0] as { receipt_prefix: string; receipt_sequence_padding: number };
    const fy = fiscalYearLabel(paymentDate);
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
      [user.tenantId, m.branch_id, paymentId, receiptNumber, seq, fy],
    );
    await queueMemberNotification(tx, user, {
      memberId: m.id,
      event: 'payment_received',
      dedupeKey: `payment:${paymentId}`,
      body: `Payment received. Receipt ${receiptNumber}.`,
    });
    await writeAudit(tx, user, {
      action: 'payment.record',
      entityType: 'payment',
      entityId: paymentId,
      after: { amount: input.amount, method: input.method, receiptNumber },
    });
    return { paymentId, receiptNumber };
  });
}

export async function refundPayment(
  user: SessionUser,
  input: { paymentId: string; amount: number; reason: string; idempotencyKey?: string },
): Promise<void> {
  return asPrincipal(user.claims, async (tx) => {
    // Row lock serializes concurrent refunds against the same payment; the
    // refunds_no_over_refund trigger enforces the bound as defense in depth.
    const pR = await tx.query(
      `SELECT id, amount::bigint AS amount, status FROM payments WHERE id = $1 FOR UPDATE`,
      [input.paymentId],
    );
    const p = pR.rows[0] as { id: string; amount: string; status: string } | undefined;
    if (!p) throw new UserFacingError('Payment not found.');
    const paid = Number(p.amount);
    const refundedR = await tx.query(
      `SELECT coalesce(sum(amount), 0)::bigint AS total FROM refunds WHERE payment_id = $1`,
      [input.paymentId],
    );
    const alreadyRefunded = Number((refundedR.rows[0] as { total: string }).total);
    if (input.amount + alreadyRefunded > paid) {
      throw new UserFacingError('Refund exceeds the remaining refundable amount.');
    }
    await tx.query(
      `INSERT INTO refunds (tenant_id, payment_id, amount, reason, approved_by, processed_by, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$5,$6)`,
      [
        user.tenantId,
        input.paymentId,
        input.amount,
        input.reason,
        user.userId,
        input.idempotencyKey ?? null,
      ],
    );
    const newStatus = input.amount + alreadyRefunded === paid ? 'refunded' : 'partially_refunded';
    await tx.query(`UPDATE payments SET status = $2 WHERE id = $1`, [input.paymentId, newStatus]);
    await writeAudit(tx, user, {
      action: 'payment.refund',
      entityType: 'payment',
      entityId: input.paymentId,
      after: { amount: input.amount, reason: input.reason, newStatus },
    });
  });
}

export interface ReceiptView {
  receipt_number: string;
  created_at: string;
  payment_date: string;
  amount: string;
  method: string;
  external_reference: string | null;
  member_name: string;
  membership_number: string;
  branch_name: string;
  gym_name: string;
  receipt_footer: string | null;
  received_by_name: string | null;
  plan_name: string | null;
  gstin: string | null;
  tax_sac_code: string | null;
  tax_state_name: string | null;
  tax_rate_bps: number | null;
  tax_amount: string | null;
  status: string;
  refunded_amount: string;
}

export async function getReceipt(
  user: SessionUser,
  paymentId: string,
): Promise<ReceiptView | null> {
  return asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(
      `SELECT r.receipt_number, r.created_at::text AS created_at,
              p.payment_date::text AS payment_date, p.amount::bigint::text AS amount, p.method,
              p.external_reference,
              m.first_name || coalesce(' ' || m.last_name, '') AS member_name,
              m.membership_number, b.name AS branch_name, t.name AS gym_name,
              gs.receipt_footer, u.display_name AS received_by_name,
              coalesce(ms.plan_name_snapshot, ma.name_snapshot) AS plan_name,
              p.status,
              -- A refunded payment used to reprint as a full-value tax
              -- invoice, which is a document claiming money the gym gave back.
              coalesce((SELECT sum(rf.amount) FROM refunds rf WHERE rf.payment_id = p.id), 0)
                ::bigint::text AS refunded_amount,
              gs.gstin, gs.tax_sac_code, gs.tax_state_name,
              -- The tax was frozen onto the membership when it was sold, and
              -- this payment may be only part of it, so the tax shown on this
              -- receipt is that snapshot pro-rated by what was actually paid
              -- here. Deriving it from today's plan rate would rewrite history.
              coalesce(ms.tax_rate_bps, ma.tax_rate_bps) AS tax_rate_bps,
              -- Half-up, not truncating: three part payments on a 3,000 plan
              -- at 18% each floor to 15,254 paise and sum to one paise less
              -- than the tax actually charged, so the receipts would not add
              -- up to the invoice. (2ab + c) / 2c is exact half-up in integers.
              CASE
                WHEN coalesce(ms.total_amount, 0) > 0
                  THEN (2 * ms.tax_amount * p.amount + ms.total_amount)
                       / (2 * ms.total_amount)
                WHEN coalesce(ma.price_snapshot, 0) > 0
                  THEN (2 * ma.tax_amount * p.amount + ma.price_snapshot)
                       / (2 * ma.price_snapshot)
                ELSE 0 END::bigint::text AS tax_amount
       FROM receipts r
       JOIN payments p ON p.id = r.payment_id
       JOIN members m ON m.id = p.member_id
       JOIN branches b ON b.id = r.branch_id
       JOIN tenants t ON t.id = r.tenant_id
       LEFT JOIN gym_settings gs ON gs.tenant_id = r.tenant_id
       LEFT JOIN users u ON u.id = p.received_by
       LEFT JOIN payment_allocations pa ON pa.payment_id = p.id
       LEFT JOIN memberships ms ON ms.id = pa.membership_id
       LEFT JOIN member_addons ma ON ma.id = pa.member_addon_id
       WHERE r.payment_id = $1`,
      [paymentId],
    );
    return (r.rows[0] as ReceiptView) ?? null;
  });
}
