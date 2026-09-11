import 'server-only';
import { todayInTz, addDays } from '@gymflow/utils';
import { asPrincipal } from '../db';
import type { SessionUser } from '../session';
import type { ExpiryRow } from './dashboard';

/**
 * The renewal queue, in full.
 *
 * The dashboard shows the first 30 memberships expiring in a fortnight's
 * window and there was no way to reach the rest — a gym with 200 renewals
 * due could work 30 of them and had no way of knowing the other 170 existed.
 * This is the same queue, with a true total, a window the gym chooses, and
 * pages.
 */

export const RENEWAL_WINDOWS = {
  /** Already past their expiry date — the ones losing the gym money today. */
  overdue: { from: -3650, to: -1 },
  today: { from: 0, to: 0 },
  '7': { from: 0, to: 7 },
  '15': { from: 0, to: 15 },
  '30': { from: 0, to: 30 },
} as const;

export type RenewalWindow = keyof typeof RENEWAL_WINDOWS;

export function isRenewalWindow(value: string | undefined): value is RenewalWindow {
  return value !== undefined && value in RENEWAL_WINDOWS;
}

export async function listRenewals(
  user: SessionUser,
  opts: { window: RenewalWindow; limit?: number; offset?: number },
): Promise<{ rows: ExpiryRow[]; total: number }> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = Math.max(0, opts.offset ?? 0);
  const today = todayInTz();
  const { from, to } = RENEWAL_WINDOWS[opts.window];
  const fromDate = addDays(today, from);
  const toDate = addDays(today, to);

  return asPrincipal(user.claims, async (tx) => {
    // Same predicate as the dashboard card, so the count on the card and the
    // length of this list can never disagree. Each query takes exactly the
    // parameters it uses: an unused $1 leaves Postgres unable to infer its
    // type and the statement never prepares.
    const totalR = await tx.query(
      `SELECT count(*)::int AS n FROM memberships ms
        WHERE ms.state = 'active' AND ms.end_date BETWEEN $1 AND $2`,
      [fromDate, toDate],
    );
    const rows = await tx.query(
      `SELECT m.id AS member_id, m.first_name, m.last_name, m.mobile, m.membership_number,
              ms.plan_name_snapshot AS plan_name, ms.end_date::text AS end_date,
              (ms.end_date - $1::date)::int AS days_left, ms.id AS membership_id
         FROM memberships ms
         JOIN members m ON m.id = ms.member_id
        WHERE ms.state = 'active' AND ms.end_date BETWEEN $2 AND $3
        ORDER BY ms.end_date ASC, m.first_name ASC
        LIMIT $4 OFFSET $5`,
      [today, fromDate, toDate, limit, offset],
    );
    return {
      rows: rows.rows as ExpiryRow[],
      total: (totalR.rows[0] as { n: number }).n,
    };
  });
}

/**
 * How many memberships are in the dashboard's own window. The card used to
 * imply its 30-row list was the whole of it.
 */
export async function countExpiryQueue(user: SessionUser): Promise<number> {
  const today = todayInTz();
  return asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(
      `SELECT count(*)::int AS n FROM memberships ms
        WHERE ms.state = 'active' AND ms.end_date BETWEEN $1 AND $2`,
      [addDays(today, -7), addDays(today, 7)],
    );
    return (r.rows[0] as { n: number }).n;
  });
}
