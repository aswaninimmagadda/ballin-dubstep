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

/**
 * Each window carries its own membership states, because "overdue" is not
 * the same set as "expiring".
 *
 * The nightly sweep only flips a membership to 'expired' once its GRACE
 * period has also run out (packages/database/scripts/sweep-memberships.ts),
 * so a membership whose end date has passed is still 'active' while the
 * member can come in, and 'expired' afterwards. An overdue list restricted
 * to 'active' therefore showed only the grace cohort and silently hid every
 * member who had actually lapsed — on this seed, 11 of them, behind the
 * words "Nothing due in this window".
 */
export const RENEWAL_WINDOWS = {
  /** The dashboard card's own window, so its count and this page agree. */
  queue: { from: -7, to: 7, states: ['active'] },
  /** Past their expiry date and not renewed: in grace, or lapsed entirely. */
  overdue: { from: -3650, to: -1, states: ['active', 'expired'] },
  today: { from: 0, to: 0, states: ['active'] },
  '7': { from: 0, to: 7, states: ['active'] },
  '15': { from: 0, to: 15, states: ['active'] },
  '30': { from: 0, to: 30, states: ['active'] },
} as const;

export type RenewalWindow = keyof typeof RENEWAL_WINDOWS;

export function isRenewalWindow(value: string | undefined): value is RenewalWindow {
  // Object.hasOwn, not `in`: `in` walks the prototype chain, so
  // ?window=constructor and ?window=toString both passed validation and then
  // read a function off Object.prototype as if it were a date range.
  return value !== undefined && Object.hasOwn(RENEWAL_WINDOWS, value);
}

export async function listRenewals(
  user: SessionUser,
  opts: { window: RenewalWindow; limit?: number; offset?: number },
): Promise<{ rows: ExpiryRow[]; total: number }> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = Math.max(0, opts.offset ?? 0);
  const today = todayInTz();
  const { from, to, states } = RENEWAL_WINDOWS[opts.window];
  const fromDate = addDays(today, from);
  const toDate = addDays(today, to);
  const stateList = [...states];

  return asPrincipal(user.claims, async (tx) => {
    // Same predicate as the dashboard card, so the count on the card and the
    // length of this list can never disagree. Each query takes exactly the
    // parameters it uses: an unused $1 leaves Postgres unable to infer its
    // type and the statement never prepares.
    const totalR = await tx.query(
      `SELECT count(*)::int AS n FROM memberships ms
        WHERE ms.state = ANY($1) AND ms.end_date BETWEEN $2 AND $3`,
      [stateList, fromDate, toDate],
    );
    const rows = await tx.query(
      `SELECT m.id AS member_id, m.first_name, m.last_name, m.mobile, m.membership_number,
              ms.plan_name_snapshot AS plan_name, ms.end_date::text AS end_date,
              (ms.end_date - $1::date)::int AS days_left, ms.id AS membership_id
         FROM memberships ms
         JOIN members m ON m.id = ms.member_id
        WHERE ms.state = ANY($2) AND ms.end_date BETWEEN $3 AND $4
        -- ms.id breaks ties. Without it, memberships sharing an end date have
        -- no stable order, and LIMIT/OFFSET paging can show the same member
        -- twice and skip another entirely.
        ORDER BY ms.end_date ASC, m.first_name ASC, ms.id ASC
        LIMIT $5 OFFSET $6`,
      [today, stateList, fromDate, toDate, limit, offset],
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
