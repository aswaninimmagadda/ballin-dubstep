import 'server-only';
import { addDays, computeTax, todayInTz } from '@gymflow/utils';
import { fiscalYearLabel, formatReceiptNumber } from '@gymflow/core';
import { asPrincipal } from '../db';
import { writeAudit } from '../audit';
import { UserFacingError } from '../errors';
import { queueMemberNotification } from './notifications';
import type { SessionUser } from '../session';

export interface AddonPackageRow {
  id: string;
  kind: string;
  name: string;
  session_count: number | null;
  validity_days: number;
  price: string;
  is_active: boolean;
}

export async function listAddonPackages(
  user: SessionUser,
  includeInactive = false,
): Promise<AddonPackageRow[]> {
  return asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(
      `SELECT id, kind, name, session_count, validity_days, price::bigint::text AS price, is_active
       FROM addon_packages ${includeInactive ? '' : 'WHERE is_active'} ORDER BY name`,
    );
    return r.rows as AddonPackageRow[];
  });
}

/**
 * Reprice an add-on package, or take it off sale.
 *
 * Unlike membership plans, add-on packages are not versioned: member_addons
 * snapshots name and price at the moment of sale (name_snapshot,
 * price_snapshot), so changing the package here cannot disturb anything
 * already sold. Without these the price was permanent, the package could not
 * be retired, and the name could not be reused — a gym that raised its PT
 * rate had nowhere to go.
 */
export async function updateAddonPackage(
  user: SessionUser,
  packageId: string,
  patch: { price?: number; isActive?: boolean },
): Promise<void> {
  return asPrincipal(user.claims, async (tx) => {
    const sets: string[] = [];
    const params: unknown[] = [packageId];
    if (patch.price !== undefined) {
      params.push(patch.price);
      sets.push(`price = $${params.length}`);
    }
    if (patch.isActive !== undefined) {
      params.push(patch.isActive);
      sets.push(`is_active = $${params.length}`);
    }
    if (!sets.length) return;
    const r = await tx.query(
      `UPDATE addon_packages SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
      params,
    );
    if ((r as { rowCount: number }).rowCount === 0) {
      throw new UserFacingError('Package not found.');
    }
    await writeAudit(tx, user, {
      action: patch.isActive === undefined ? 'addon_package.reprice' : 'addon_package.set_active',
      entityType: 'addon_package',
      entityId: packageId,
      after: patch as Record<string, unknown>,
    });
  });
}

export async function createAddonPackage(
  user: SessionUser,
  input: {
    kind: string;
    name: string;
    sessionCount?: number | null;
    validityDays: number;
    price: number;
    taxRateBps?: number;
    taxInclusive?: boolean;
  },
): Promise<string> {
  return asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(
      `INSERT INTO addon_packages (tenant_id, kind, name, session_count, validity_days, price,
                                   tax_rate_bps, tax_inclusive)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        user.tenantId,
        input.kind,
        input.name,
        input.sessionCount ?? null,
        input.validityDays,
        input.price,
        input.taxRateBps ?? 0,
        input.taxInclusive ?? true,
      ],
    );
    const id = (r.rows[0] as { id: string }).id;
    await writeAudit(tx, user, {
      action: 'addon_package.create',
      entityType: 'addon_package',
      entityId: id,
      after: { name: input.name, price: input.price },
    });
    return id;
  });
}

/**
 * Sell an add-on (PT package, locker, class pass…) to a member, optionally
 * with immediate payment + receipt.
 */
export async function sellAddon(
  user: SessionUser,
  input: {
    memberId: string;
    addonPackageId: string;
    trainerId?: string | null;
    startDate?: string;
    idempotencyKey: string;
    payment?: { amount: number; method: string; externalReference?: string | null } | null;
  },
): Promise<{ memberAddonId: string; receiptNumber: string | null }> {
  const today = todayInTz();
  const start = input.startDate ?? today;
  return asPrincipal(user.claims, async (tx) => {
    const mR = await tx.query(`SELECT id, branch_id FROM members WHERE id = $1`, [input.memberId]);
    const m = mR.rows[0] as { id: string; branch_id: string } | undefined;
    if (!m) throw new UserFacingError('Member not found.');

    const pR = await tx.query(
      `SELECT id, name, session_count, validity_days, price::bigint AS price,
              tax_rate_bps, tax_inclusive
       FROM addon_packages WHERE id = $1 AND is_active`,
      [input.addonPackageId],
    );
    const pkg = pR.rows[0] as
      | {
          id: string;
          name: string;
          session_count: number | null;
          validity_days: number;
          price: string;
          tax_rate_bps: number;
          tax_inclusive: boolean;
        }
      | undefined;
    if (!pkg) throw new UserFacingError('This package is not available.');
    // PT is the same taxable supply as a membership (SAC 999723). Splitting
    // the tax here and snapshotting it keeps a registered gym's invoices
    // adding up — without it every PT sale printed an untaxed receipt.
    const split = computeTax(Number(pkg.price), pkg.tax_rate_bps, pkg.tax_inclusive);
    const price = split.gross;

    const aR = await tx.query(
      `INSERT INTO member_addons
        (tenant_id, member_id, addon_package_id, name_snapshot, price_snapshot, trainer_id,
         sessions_total, start_date, end_date, idempotency_key, tax_amount, tax_rate_bps)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [
        user.tenantId,
        m.id,
        pkg.id,
        pkg.name,
        price,
        input.trainerId ?? null,
        pkg.session_count,
        start,
        addDays(start, pkg.validity_days),
        input.idempotencyKey,
        split.tax,
        pkg.tax_rate_bps,
      ],
    );
    const memberAddonId = (aR.rows[0] as { id: string }).id;

    let receiptNumber: string | null = null;
    if (input.payment && input.payment.amount > 0) {
      if (input.payment.amount > price) {
        throw new UserFacingError('Payment is more than the package price.');
      }
      const payR = await tx.query(
        `INSERT INTO payments (tenant_id, branch_id, member_id, amount, method, payment_date,
                               external_reference, received_by, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          user.tenantId,
          m.branch_id,
          m.id,
          input.payment.amount,
          input.payment.method,
          today,
          input.payment.externalReference ?? null,
          user.userId,
          `${input.idempotencyKey}:payment`,
        ],
      );
      const paymentId = (payR.rows[0] as { id: string }).id;
      await tx.query(
        `INSERT INTO payment_allocations (tenant_id, payment_id, member_addon_id, amount)
         VALUES ($1,$2,$3,$4)`,
        [user.tenantId, paymentId, memberAddonId, input.payment.amount],
      );
      const sR = await tx.query(
        `SELECT receipt_prefix, receipt_sequence_padding FROM gym_settings WHERE tenant_id = $1`,
        [user.tenantId],
      );
      const s = sR.rows[0] as { receipt_prefix: string; receipt_sequence_padding: number };
      const fy = fiscalYearLabel(today);
      const seqR = await tx.query(`SELECT app.next_receipt_seq($1, $2) AS seq`, [
        user.tenantId,
        fy,
      ]);
      const seq = Number((seqR.rows[0] as { seq: string }).seq);
      receiptNumber = formatReceiptNumber({
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
        body: `Payment received for ${pkg.name}. Receipt ${receiptNumber}.`,
      });
    }

    await writeAudit(tx, user, {
      action: 'addon.sell',
      entityType: 'member_addon',
      entityId: memberAddonId,
      after: { package: pkg.name, price, receiptNumber },
    });
    return { memberAddonId, receiptNumber };
  });
}

/**
 * Log a completed PT session against an add-on: one trainer_sessions row +
 * sessions_used increment in the same transaction. Marks the add-on
 * completed when the last session is used.
 */
export async function logPtSession(
  user: SessionUser,
  input: { memberAddonId: string; status?: 'completed' | 'member_no_show' },
): Promise<{ sessionsUsed: number; sessionsTotal: number | null }> {
  return asPrincipal(user.claims, async (tx) => {
    const aR = await tx.query(
      `SELECT ma.id, ma.member_id, ma.trainer_id, ma.sessions_total, ma.sessions_used, ma.state,
              m.branch_id, t.default_timezone
       FROM member_addons ma
       JOIN members m ON m.id = ma.member_id
       JOIN tenants t ON t.id = ma.tenant_id
       WHERE ma.id = $1 FOR UPDATE OF ma`,
      [input.memberAddonId],
    );
    const a = aR.rows[0] as
      | {
          id: string;
          member_id: string;
          trainer_id: string | null;
          sessions_total: number | null;
          sessions_used: number;
          state: string;
          branch_id: string;
          default_timezone: string;
        }
      | undefined;
    if (!a) throw new UserFacingError('Package not found.');
    if (a.state !== 'active') throw new UserFacingError('This package is not active.');
    if (a.sessions_total != null && a.sessions_used >= a.sessions_total) {
      throw new UserFacingError('All sessions in this package are already used.');
    }
    if (!a.trainer_id) {
      throw new UserFacingError('Assign a trainer to this package before logging sessions.');
    }

    // Log at the gym's wall-clock time. end_time must stay > start_time and
    // inside the same day, so a 23:59 log is recorded as 23:58–23:59.
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: a.default_timezone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date());
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    // Intl may render midnight as "24"; normalize to minutes-since-midnight.
    let startMin = (get('hour') % 24) * 60 + get('minute');
    if (startMin >= 23 * 60 + 59) startMin = 23 * 60 + 58;
    const asTime = (min: number) =>
      `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
    await tx.query(
      `INSERT INTO trainer_sessions
        (tenant_id, branch_id, trainer_id, member_id, member_addon_id, session_date,
         start_time, end_time, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        user.tenantId,
        a.branch_id,
        a.trainer_id,
        a.member_id,
        a.id,
        todayInTz(a.default_timezone),
        asTime(startMin),
        asTime(startMin + 1),
        input.status ?? 'completed',
      ],
    );
    const consumed = (input.status ?? 'completed') === 'completed';
    const newUsed = a.sessions_used + (consumed ? 1 : 0);
    const done = a.sessions_total != null && newUsed >= a.sessions_total;
    await tx.query(`UPDATE member_addons SET sessions_used = $2, state = $3 WHERE id = $1`, [
      a.id,
      newUsed,
      done ? 'completed' : 'active',
    ]);
    await writeAudit(tx, user, {
      action: 'pt.session_log',
      entityType: 'member_addon',
      entityId: a.id,
      after: { status: input.status ?? 'completed', sessionsUsed: newUsed },
    });
    return { sessionsUsed: newUsed, sessionsTotal: a.sessions_total };
  });
}
