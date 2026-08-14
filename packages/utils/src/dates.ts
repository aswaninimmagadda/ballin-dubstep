/**
 * Calendar-date utilities. Memberships operate on *calendar dates* in the
 * branch's timezone (default Asia/Kolkata), never raw timestamps, so a
 * membership sold "for 3 months from 15-Jun" behaves identically regardless
 * of the server's clock or DST-free IST oddities.
 *
 * Dates are ISO strings (YYYY-MM-DD). Internally we use UTC Date objects
 * pinned to midnight so arithmetic can never cross a timezone boundary.
 */

export class DateError extends Error {}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertISODate(d: string, label = 'date'): string {
  if (!ISO_DATE_RE.test(d)) throw new DateError(`${label} must be YYYY-MM-DD, got "${d}"`);
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, day));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== day) {
    throw new DateError(`${label} is not a real calendar date: "${d}"`);
  }
  return d;
}

function toUTC(d: string): Date {
  assertISODate(d);
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, day));
}

function fromUTC(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = `${dt.getUTCMonth() + 1}`.padStart(2, '0');
  const d = `${dt.getUTCDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(date: string, days: number): string {
  const dt = toUTC(date);
  dt.setUTCDate(dt.getUTCDate() + days);
  return fromUTC(dt);
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/**
 * Add calendar months with end-of-month clamping:
 *   31-Jan + 1 month -> 28-Feb (29-Feb in leap years)
 *   30-Apr + 1 month -> 30-May
 * This is the industry-standard behaviour for subscription periods.
 */
export function addMonthsClamped(date: string, months: number): string {
  const dt = toUTC(date);
  const day = dt.getUTCDate();
  const targetMonthIndex = dt.getUTCMonth() + months;
  const targetYear = dt.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12; // 0-based
  const clampDay = Math.min(day, daysInMonth(targetYear, targetMonth + 1));
  return fromUTC(new Date(Date.UTC(targetYear, targetMonth, clampDay)));
}

/** Whole-day difference b - a (positive when b is after a). */
export function diffDays(a: string, b: string): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / 86_400_000);
}

export function compareDates(a: string, b: string): -1 | 0 | 1 {
  const d = diffDays(b, a);
  return d < 0 ? -1 : d > 0 ? 1 : 0;
}

export function maxDate(a: string, b: string): string {
  return compareDates(a, b) >= 0 ? a : b;
}

/** Today's calendar date in an IANA timezone (default Asia/Kolkata). */
export function todayInTz(timezone = 'Asia/Kolkata', now: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(now); // en-CA yields YYYY-MM-DD
}

/** Format an ISO date for display, e.g. "2026-06-01" -> "01-Jun-2026". */
export function formatDisplayDate(date: string, style: 'DD-MM-YYYY' | 'DD-Mon-YYYY' = 'DD-Mon-YYYY'): string {
  assertISODate(date);
  const [y, m, d] = date.split('-') as [string, string, string];
  if (style === 'DD-MM-YYYY') return `${d}-${m}-${y}`;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d}-${months[Number(m) - 1]}-${y}`;
}
