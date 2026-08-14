import 'server-only';
import { createHash } from 'node:crypto';
import {
  importMemberRowSchema,
  IMPORT_TEMPLATE_HEADERS,
  type ImportMemberRow,
} from '@gymflow/validation';
import { computeEndDate, fiscalYearLabel, formatReceiptNumber } from '@gymflow/core';
import { parseMoney, todayInTz } from '@gymflow/utils';
import { asPrincipal } from '../db';
import { writeAudit } from '../audit';
import { UserFacingError } from '../errors';
import type { SessionUser } from '../session';

/**
 * CSV member import (migration from notebooks/Excel).
 * Flow: parse → validate every row → preview with per-row errors +
 * duplicate detection (dry run) → confirm imports ONLY when zero errors.
 * The confirm step re-validates server-side; nothing imports silently.
 */

export interface ImportRowResult {
  line: number;
  raw: Record<string, string>;
  errors: string[];
  warnings: string[];
  parsed?: ImportMemberRow;
}

export interface ImportPreview {
  rows: ImportRowResult[];
  validCount: number;
  errorCount: number;
  /** Opaque digest of the validated content; confirm must match. */
  digest: string;
}

/** Minimal CSV parser (quoted fields, commas, CRLF). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);

  const [header, ...data] = rows;
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return data.map((cells) =>
    Object.fromEntries(keys.map((k, idx) => [k, (cells[idx] ?? '').trim()])),
  );
}

export function importTemplateCsv(): string {
  return (
    IMPORT_TEMPLATE_HEADERS.join(',') +
    '\nRavi Kumar,9876543210,3 Month,2026-05-01,2026-07-31,2500,cash,,Joined during Sankranti offer\n'
  );
}

export async function previewImport(user: SessionUser, csvText: string): Promise<ImportPreview> {
  if (csvText.length > 1_000_000) throw new UserFacingError('File is too large (max ~1MB).');
  const records = parseCsv(csvText);
  if (records.length === 0) throw new UserFacingError('No rows found. Use the template format.');
  if (records.length > 2000)
    throw new UserFacingError('Too many rows at once (max 2000). Split the file.');

  const planNames = await asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(`SELECT name FROM membership_plans WHERE is_active`);
    return new Set((r.rows as { name: string }[]).map((p) => p.name.toLowerCase()));
  });
  const existingMobiles = await asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(`SELECT mobile FROM members WHERE archived_at IS NULL`);
    return new Set((r.rows as { mobile: string }[]).map((m) => m.mobile));
  });

  const seenInFile = new Set<string>();
  const rows: ImportRowResult[] = records.map((raw, i) => {
    const result: ImportRowResult = { line: i + 2, raw, errors: [], warnings: [] };
    const parsed = importMemberRowSchema.safeParse(raw);
    if (!parsed.success) {
      result.errors = parsed.error.issues.map((iss) => `${iss.path.join('.')}: ${iss.message}`);
      return result;
    }
    result.parsed = parsed.data;
    const p = parsed.data;
    if (!planNames.has(p.membership_plan.toLowerCase())) {
      result.errors.push(
        `membership_plan: no active plan named "${p.membership_plan}" — create it first`,
      );
    }
    if (p.expiry_date && p.expiry_date < p.start_date) {
      result.errors.push('expiry_date: before start_date');
    }
    if (existingMobiles.has(p.mobile)) {
      result.errors.push('mobile: a member with this number already exists');
    }
    if (seenInFile.has(p.mobile)) {
      result.errors.push('mobile: duplicated within this file');
    }
    seenInFile.add(p.mobile);
    if (!p.expiry_date) result.warnings.push('expiry will be computed from the plan duration');
    if (!p.amount_paid) result.warnings.push('no payment will be recorded');
    return result;
  });

  const errorCount = rows.filter((r) => r.errors.length > 0).length;
  return {
    rows,
    validCount: rows.length - errorCount,
    errorCount,
    digest: createHash('sha256').update(csvText).digest('hex'),
  };
}

export interface ImportResult {
  imported: number;
  receipts: number;
}

/** Execute a previously-previewed import. Refuses if any row is invalid. */
export async function executeImport(
  user: SessionUser,
  csvText: string,
  confirmedDigest: string,
): Promise<ImportResult> {
  const preview = await previewImport(user, csvText);
  if (preview.digest !== confirmedDigest) {
    throw new UserFacingError(
      'The file changed since the preview. Preview again before importing.',
    );
  }
  if (preview.errorCount > 0) {
    throw new UserFacingError(
      `Fix the ${preview.errorCount} row(s) with errors before importing — nothing was imported.`,
    );
  }
  const today = todayInTz();

  return asPrincipal(user.claims, async (tx) => {
    const branchR = await tx.query(
      `SELECT id FROM branches WHERE is_active ORDER BY created_at LIMIT 1`,
    );
    const branchId = (branchR.rows[0] as { id: string } | undefined)?.id;
    if (!branchId) throw new UserFacingError('Create a branch before importing.');

    const plansR = await tx.query(
      `SELECT p.id, p.name, v.id AS version_id, v.duration_unit, v.duration_value, v.grace_period_days
       FROM membership_plans p
       JOIN LATERAL (SELECT * FROM membership_plan_versions WHERE plan_id = p.id
                     ORDER BY version DESC LIMIT 1) v ON true
       WHERE p.is_active`,
    );
    const planByName = new Map(
      (
        plansR.rows as {
          id: string;
          name: string;
          version_id: string;
          duration_unit: 'days' | 'months';
          duration_value: number;
          grace_period_days: number;
        }[]
      ).map((p) => [p.name.toLowerCase(), p]),
    );

    const settingsR = await tx.query(
      `SELECT receipt_prefix, receipt_sequence_padding FROM gym_settings WHERE tenant_id = $1`,
      [user.tenantId],
    );
    const settings = settingsR.rows[0] as {
      receipt_prefix: string;
      receipt_sequence_padding: number;
    };

    let imported = 0;
    let receipts = 0;
    for (const row of preview.rows) {
      const p = row.parsed!;
      const plan = planByName.get(p.membership_plan.toLowerCase())!;
      const nameParts = p.member_name.split(/\s+/);
      const numR = await tx.query(`SELECT app.next_membership_number($1) AS n`, [user.tenantId]);
      const membershipNumber = (numR.rows[0] as { n: string }).n;

      const endDate =
        p.expiry_date ||
        computeEndDate({
          startDate: p.start_date,
          durationUnit: plan.duration_unit,
          durationValue: plan.duration_value,
        });
      const state = endDate < today ? 'expired' : p.start_date > today ? 'pending' : 'active';
      const memberStatus =
        state === 'expired' ? 'expired' : state === 'pending' ? 'pending_activation' : 'active';

      const mR = await tx.query(
        `INSERT INTO members (tenant_id, branch_id, membership_number, first_name, last_name,
                              mobile, join_date, status, notes, referral_source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'import') RETURNING id`,
        [
          user.tenantId,
          branchId,
          membershipNumber,
          nameParts[0],
          nameParts.slice(1).join(' ') || null,
          p.mobile,
          p.start_date < today ? p.start_date : today,
          memberStatus,
          p.notes || null,
        ],
      );
      const memberId = (mR.rows[0] as { id: string }).id;

      const amount = p.amount_paid ? parseMoney(p.amount_paid) : 0;
      const msR = await tx.query(
        `INSERT INTO memberships
          (tenant_id, branch_id, member_id, plan_id, plan_version_id, plan_name_snapshot,
           start_date, base_end_date, end_date, grace_period_days, state, total_amount, sold_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12) RETURNING id`,
        [
          user.tenantId,
          branchId,
          memberId,
          plan.id,
          plan.version_id,
          plan.name,
          p.start_date,
          endDate,
          plan.grace_period_days,
          state,
          amount,
          user.userId,
        ],
      );
      const membershipId = (msR.rows[0] as { id: string }).id;
      await tx.query(
        `INSERT INTO membership_events (tenant_id, membership_id, type, data, actor_id)
         VALUES ($1,$2,'sold',$3,$4)`,
        [user.tenantId, membershipId, JSON.stringify({ source: 'import' }), user.userId],
      );

      if (amount > 0) {
        const payR = await tx.query(
          `INSERT INTO payments (tenant_id, branch_id, member_id, amount, method, payment_date, received_by, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'imported') RETURNING id`,
          [
            user.tenantId,
            branchId,
            memberId,
            amount,
            p.payment_method || 'cash',
            p.start_date,
            user.userId,
          ],
        );
        const paymentId = (payR.rows[0] as { id: string }).id;
        await tx.query(
          `INSERT INTO payment_allocations (tenant_id, payment_id, membership_id, amount)
           VALUES ($1,$2,$3,$4)`,
          [user.tenantId, paymentId, membershipId, amount],
        );
        const fy = fiscalYearLabel(p.start_date);
        const seqR = await tx.query(`SELECT app.next_receipt_seq($1, $2) AS seq`, [
          user.tenantId,
          fy,
        ]);
        const seq = Number((seqR.rows[0] as { seq: string }).seq);
        await tx.query(
          `INSERT INTO receipts (tenant_id, branch_id, payment_id, receipt_number, sequence, fiscal_year)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            user.tenantId,
            branchId,
            paymentId,
            formatReceiptNumber({
              prefix: settings.receipt_prefix,
              fiscalYear: fy,
              sequence: seq,
              padding: settings.receipt_sequence_padding,
            }),
            seq,
            fy,
          ],
        );
        receipts += 1;
      }
      imported += 1;
    }

    await writeAudit(tx, user, {
      action: 'import.members',
      entityType: 'import',
      after: { imported, receipts },
    });
    return { imported, receipts };
  });
}
