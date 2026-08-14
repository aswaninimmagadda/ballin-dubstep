import 'server-only';
import { fiscalYearLabel, formatReceiptNumber } from '@gymflow/core';
import { todayInTz } from '@gymflow/utils';
import type { RecordPaymentInput } from '@gymflow/validation';
import { asPrincipal } from '../db';
import { writeAudit } from '../audit';
import { UserFacingError } from '../errors';
import type { SessionUser } from '../session';

export async function recordPayment(
  user: SessionUser,
  input: RecordPaymentInput,
): Promise<{ paymentId: string; receiptNumber: string }> {
  const today = todayInTz();
  return asPrincipal(user.claims, async (tx) => {
    const mR = await tx.query(`SELECT id, branch_id FROM members WHERE id = $1`, [input.memberId]);
    const m = mR.rows[0] as { id: string; branch_id: string } | undefined;
    if (!m) throw new UserFacingError('Member not found.');

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
        input.paymentDate ?? today,
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
    const fy = fiscalYearLabel(input.paymentDate ?? today);
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
  input: { paymentId: string; amount: number; reason: string },
): Promise<void> {
  return asPrincipal(user.claims, async (tx) => {
    const pR = await tx.query(
      `SELECT id, amount::bigint AS amount, status FROM payments WHERE id = $1`,
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
      `INSERT INTO refunds (tenant_id, payment_id, amount, reason, approved_by, processed_by)
       VALUES ($1,$2,$3,$4,$5,$5)`,
      [user.tenantId, input.paymentId, input.amount, input.reason, user.userId],
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
              ms.plan_name_snapshot AS plan_name
       FROM receipts r
       JOIN payments p ON p.id = r.payment_id
       JOIN members m ON m.id = p.member_id
       JOIN branches b ON b.id = r.branch_id
       JOIN tenants t ON t.id = r.tenant_id
       LEFT JOIN gym_settings gs ON gs.tenant_id = r.tenant_id
       LEFT JOIN users u ON u.id = p.received_by
       LEFT JOIN payment_allocations pa ON pa.payment_id = p.id
       LEFT JOIN memberships ms ON ms.id = pa.membership_id
       WHERE r.payment_id = $1`,
      [paymentId],
    );
    return (r.rows[0] as ReceiptView) ?? null;
  });
}
