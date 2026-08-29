import 'server-only';
import { createHash } from 'node:crypto';
import {
  importMemberRowSchema,
  IMPORT_TEMPLATE_HEADERS,
  type ImportMemberRow,
} from '@gymflow/validation';
import { computeEndDate, fiscalYearLabel, formatReceiptNumber } from '@gymflow/core';
import { computeTax, parseMoney, todayInTz } from '@gymflow/utils';
import { asPrincipal, type Queryable } from '../db';
import { writeAudit } from '../audit';
import { UserFacingError } from '../errors';
import { log } from '../log';
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
  // Excel saves "CSV UTF-8" with a byte-order mark; without stripping it the
  // first header would be "﻿member_name" and every row would fail.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
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

/**
 * Park a pasted/uploaded CSV server-side between the preview POST and the
 * confirm POST — member PII must never round-trip through a URL query
 * string. Stashes are single-use working data; day-old ones are swept.
 */
export async function stashCsv(user: SessionUser, csv: string): Promise<string> {
  return asPrincipal(user.claims, async (tx) => {
    await tx.query(`DELETE FROM csv_import_stash WHERE created_at < now() - interval '1 day'`);
    const r = await tx.query(
      `INSERT INTO csv_import_stash (tenant_id, created_by, csv) VALUES ($1,$2,$3) RETURNING id`,
      [user.tenantId, user.userId, csv],
    );
    return (r.rows[0] as { id: string }).id;
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadStashedCsv(user: SessionUser, stashId: string): Promise<string | null> {
  if (!UUID_RE.test(stashId)) return null;
  return asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(`SELECT csv FROM csv_import_stash WHERE id = $1`, [stashId]);
    return (r.rows[0] as { csv: string } | undefined)?.csv ?? null;
  });
}

export async function deleteStashedCsv(user: SessionUser, stashId: string): Promise<void> {
  if (!UUID_RE.test(stashId)) return;
  return asPrincipal(user.claims, async (tx) => {
    await tx.query(`DELETE FROM csv_import_stash WHERE id = $1`, [stashId]);
  });
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
  const startedAt = Date.now();

  return asPrincipal(user.claims, async (raw) => {
    // Count what this import actually costs the database. An import is the
    // one operation whose statement count scales with the file, so the number
    // belongs in the log: if it ever tracks the row count again, someone has
    // put a query back inside a loop.
    let statements = 0;
    const tx: Queryable = {
      query: ((text: never, params: never) => {
        statements += 1;
        return raw.query(text, params);
      }) as Queryable['query'],
    };
    const branchR = await tx.query(
      `SELECT id FROM branches WHERE is_active ORDER BY created_at LIMIT 1`,
    );
    const branchId = (branchR.rows[0] as { id: string } | undefined)?.id;
    if (!branchId) throw new UserFacingError('Create a branch before importing.');

    const plansR = await tx.query(
      `SELECT p.id, p.name, v.id AS version_id, v.duration_unit, v.duration_value,
              v.grace_period_days, v.base_price::bigint::text AS base_price,
              v.tax_rate_bps, v.tax_inclusive
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
          base_price: string;
          tax_rate_bps: number;
          tax_inclusive: boolean;
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

    // One statement per table, not one per row. The old loop issued up to
    // eight round trips for every member — a 2,000-row book was ~16,000
    // sequential queries inside a single transaction, which took minutes on a
    // gym's ADSL line and held write locks the whole time. Every insert below
    // is a single set-based statement fed by unnest(), so the cost is a fixed
    // handful of round trips whatever the file size.
    const rows = preview.rows.map((row) => {
      const p = row.parsed!;
      const plan = planByName.get(p.membership_plan.toLowerCase())!;
      const nameParts = p.member_name.split(/\s+/);
      const endDate =
        p.expiry_date ||
        computeEndDate({
          startDate: p.start_date,
          durationUnit: plan.duration_unit,
          durationValue: plan.duration_value,
        });
      const state = endDate < today ? 'expired' : p.start_date > today ? 'pending' : 'active';
      // total_amount is what the member CONTRACTED to pay — the plan's price —
      // not what they had already handed over. Writing the paid figure here
      // recorded every part-paid member as fully settled, so a gym migrating
      // its book on day one silently wrote off every outstanding balance it
      // had, with nothing on any screen to show it had happened.
      const taxSplit = computeTax(Number(plan.base_price), plan.tax_rate_bps, plan.tax_inclusive);
      return {
        plan,
        firstName: nameParts[0],
        lastName: nameParts.slice(1).join(' ') || null,
        mobile: p.mobile,
        joinDate: p.start_date < today ? p.start_date : today,
        memberStatus:
          state === 'expired' ? 'expired' : state === 'pending' ? 'pending_activation' : 'active',
        notes: p.notes || null,
        startDate: p.start_date,
        endDate,
        state,
        total: taxSplit.gross,
        tax: taxSplit.tax,
        amount: p.amount_paid ? parseMoney(p.amount_paid) : 0,
        method: p.payment_method || 'cash',
      };
    });

    // Membership numbers come from a VOLATILE sequence function, so one call
    // per row is still required — but generate_series makes it one round trip.
    const numsR = await tx.query(
      `SELECT app.next_membership_number($1) AS n FROM generate_series(1, $2)`,
      [user.tenantId, rows.length],
    );
    const numbers = (numsR.rows as { n: string }[]).map((r) => r.n);

    // RETURNING order is not guaranteed, so every batch maps its results back
    // by a natural key rather than by position: membership_number for members,
    // member_id for the per-member rows below.
    const membersR = await tx.query(
      `INSERT INTO members (tenant_id, branch_id, membership_number, first_name, last_name,
                            mobile, join_date, status, notes, referral_source)
       SELECT $1::uuid, $2::uuid, t.num, t.first, t.last, t.mobile, t.join_date, t.status,
              t.notes, 'import'
       FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::date[], $8::text[],
                   $9::text[]) AS t(num, first, last, mobile, join_date, status, notes)
       RETURNING id, membership_number`,
      [
        user.tenantId,
        branchId,
        numbers,
        rows.map((r) => r.firstName),
        rows.map((r) => r.lastName),
        rows.map((r) => r.mobile),
        rows.map((r) => r.joinDate),
        rows.map((r) => r.memberStatus),
        rows.map((r) => r.notes),
      ],
    );
    const memberIdByNumber = new Map(
      (membersR.rows as { id: string; membership_number: string }[]).map((m) => [
        m.membership_number,
        m.id,
      ]),
    );
    const memberIds = numbers.map((n) => memberIdByNumber.get(n)!);

    const membershipsR = await tx.query(
      `INSERT INTO memberships
        (tenant_id, branch_id, member_id, plan_id, plan_version_id, plan_name_snapshot,
         start_date, base_end_date, end_date, grace_period_days, state, total_amount, sold_by,
         tax_amount, tax_rate_bps)
       SELECT $1::uuid, $2::uuid, t.member_id, t.plan_id, t.version_id, t.plan_name,
              t.start_date, t.end_date, t.end_date, t.grace, t.state, t.total, $3::uuid,
              t.tax, t.tax_bps
       FROM unnest($4::uuid[], $5::uuid[], $6::uuid[], $7::text[], $8::date[], $9::date[],
                   $10::int[], $11::text[], $12::bigint[], $13::bigint[], $14::int[])
         AS t(member_id, plan_id, version_id, plan_name, start_date, end_date, grace, state,
              total, tax, tax_bps)
       RETURNING id, member_id`,
      [
        user.tenantId,
        branchId,
        user.userId,
        memberIds,
        rows.map((r) => r.plan.id),
        rows.map((r) => r.plan.version_id),
        rows.map((r) => r.plan.name),
        rows.map((r) => r.startDate),
        rows.map((r) => r.endDate),
        rows.map((r) => r.plan.grace_period_days),
        rows.map((r) => r.state),
        rows.map((r) => String(r.total)),
        rows.map((r) => String(r.tax)),
        rows.map((r) => r.plan.tax_rate_bps),
      ],
    );
    const membershipIdByMember = new Map(
      (membershipsR.rows as { id: string; member_id: string }[]).map((m) => [m.member_id, m.id]),
    );
    const membershipIds = memberIds.map((id) => membershipIdByMember.get(id)!);

    await tx.query(
      `INSERT INTO membership_events (tenant_id, membership_id, type, data, actor_id)
       SELECT $1::uuid, t.membership_id, 'sold', $2::jsonb, $3::uuid
       FROM unnest($4::uuid[]) AS t(membership_id)`,
      [user.tenantId, JSON.stringify({ source: 'import' }), user.userId, membershipIds],
    );

    const paying = rows
      .map((r, i) => ({ ...r, memberId: memberIds[i]!, membershipId: membershipIds[i]! }))
      .filter((r) => r.amount > 0);

    if (paying.length > 0) {
      const paymentsR = await tx.query(
        `INSERT INTO payments (tenant_id, branch_id, member_id, amount, method, payment_date,
                               received_by, notes)
         SELECT $1::uuid, $2::uuid, t.member_id, t.amount, t.method, t.paid_on, $3::uuid, 'imported'
         FROM unnest($4::uuid[], $5::bigint[], $6::text[], $7::date[])
           AS t(member_id, amount, method, paid_on)
         RETURNING id, member_id`,
        [
          user.tenantId,
          branchId,
          user.userId,
          paying.map((r) => r.memberId),
          paying.map((r) => String(r.amount)),
          paying.map((r) => r.method),
          paying.map((r) => r.startDate),
        ],
      );
      // One payment per member in an import, and the preview refuses duplicate
      // mobiles, so member_id identifies a payment uniquely here.
      const paymentIdByMember = new Map(
        (paymentsR.rows as { id: string; member_id: string }[]).map((p) => [p.member_id, p.id]),
      );
      const paymentIds = paying.map((r) => paymentIdByMember.get(r.memberId)!);

      await tx.query(
        `INSERT INTO payment_allocations (tenant_id, payment_id, membership_id, amount)
         SELECT $1::uuid, t.payment_id, t.membership_id, t.amount
         FROM unnest($2::uuid[], $3::uuid[], $4::bigint[])
           AS t(payment_id, membership_id, amount)`,
        [
          user.tenantId,
          paymentIds,
          paying.map((r) => r.membershipId),
          paying.map((r) => String(r.amount)),
        ],
      );

      // Receipt numbers are per fiscal year, so draw each year's block in one
      // call and hand them out in the order the rows appear.
      const years = [...new Set(paying.map((r) => fiscalYearLabel(r.startDate)))];
      const seqByYear = new Map<string, number[]>();
      for (const fy of years) {
        const wanted = paying.filter((r) => fiscalYearLabel(r.startDate) === fy).length;
        const seqR = await tx.query(
          `SELECT app.next_receipt_seq($1, $2) AS seq FROM generate_series(1, $3)`,
          [user.tenantId, fy, wanted],
        );
        seqByYear.set(
          fy,
          (seqR.rows as { seq: string }[]).map((r) => Number(r.seq)),
        );
      }
      const cursor = new Map(years.map((fy) => [fy, 0]));
      const receiptRows = paying.map((r, i) => {
        const fy = fiscalYearLabel(r.startDate);
        const at = cursor.get(fy)!;
        cursor.set(fy, at + 1);
        const seq = seqByYear.get(fy)![at]!;
        return {
          paymentId: paymentIds[i]!,
          fy,
          seq,
          number: formatReceiptNumber({
            prefix: settings.receipt_prefix,
            fiscalYear: fy,
            sequence: seq,
            padding: settings.receipt_sequence_padding,
          }),
        };
      });

      await tx.query(
        `INSERT INTO receipts (tenant_id, branch_id, payment_id, receipt_number, sequence,
                               fiscal_year)
         SELECT $1::uuid, $2::uuid, t.payment_id, t.number, t.seq, t.fy
         FROM unnest($3::uuid[], $4::text[], $5::bigint[], $6::text[])
           AS t(payment_id, number, seq, fy)`,
        [
          user.tenantId,
          branchId,
          receiptRows.map((r) => r.paymentId),
          receiptRows.map((r) => r.number),
          receiptRows.map((r) => String(r.seq)),
          receiptRows.map((r) => r.fy),
        ],
      );
    }

    const imported = rows.length;
    const receipts = paying.length;

    await writeAudit(tx, user, {
      action: 'import.members',
      entityType: 'import',
      // `statements` is what this import cost the database. It belongs with
      // the record of the import itself: it must stay flat as the file grows,
      // and if it ever tracks the row count again someone has put a query
      // back inside a loop.
      after: { imported, receipts, statements },
    });
    log.info('import.members', {
      tenantId: user.tenantId,
      userId: user.userId,
      imported,
      receipts,
      statements,
      ms: Date.now() - startedAt,
    });
    return { imported, receipts };
  });
}
