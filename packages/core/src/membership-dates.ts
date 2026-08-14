import { addDays, addMonthsClamped, assertISODate, diffDays, maxDate } from '@gymflow/utils';
import type { PlanDurationUnit } from '@gymflow/types';

/**
 * THE single source of truth for membership period arithmetic. No screen or
 * API handler may re-implement these rules.
 */

export interface PeriodInput {
  startDate: string;
  durationUnit: PlanDurationUnit;
  durationValue: number;
}

/**
 * Compute the (inclusive) end date of a membership period.
 * Month-based plans: last day is the day *before* the same date N months on,
 * so a 1-month plan starting 01-Jun ends 30-Jun and renewal starts 01-Jul.
 * Day-based plans: N days of access counting the start day itself.
 */
export function computeEndDate(input: PeriodInput): string {
  assertISODate(input.startDate, 'startDate');
  if (!Number.isInteger(input.durationValue) || input.durationValue <= 0) {
    throw new Error(`durationValue must be a positive integer, got ${input.durationValue}`);
  }
  if (input.durationUnit === 'months') {
    return addDays(addMonthsClamped(input.startDate, input.durationValue), -1);
  }
  return addDays(input.startDate, input.durationValue - 1);
}

/** Last day of the grace window (endDate when graceDays = 0). */
export function graceEndDate(endDate: string, graceDays: number): string {
  if (!Number.isInteger(graceDays) || graceDays < 0) {
    throw new Error(`graceDays must be >= 0, got ${graceDays}`);
  }
  return addDays(endDate, graceDays);
}

/**
 * Extend expiry for a completed freeze. Only freezes flagged extendsExpiry
 * add days. Freeze days = calendar days from freeze start to actual end
 * (exclusive of the resume day), minimum 1.
 */
export function freezeExtensionDays(freezeStart: string, freezeEnd: string): number {
  const d = diffDays(freezeStart, freezeEnd);
  if (d < 0) throw new Error('freeze end cannot be before freeze start');
  return Math.max(d, 1);
}

export function applyFreezeExtension(endDate: string, extensionDays: number): string {
  if (!Number.isInteger(extensionDays) || extensionDays < 0) {
    throw new Error(`extensionDays must be >= 0, got ${extensionDays}`);
  }
  return addDays(endDate, extensionDays);
}

/**
 * Start date for a renewal: the day after the later of (current expiry, today).
 * - Renewing before expiry: continue seamlessly from expiry + 1.
 * - Renewing after expiry: start fresh from today (a lapsed member renewing
 *   on the 10th shouldn't lose the lapsed days).
 * A tenant can override with an explicit start date.
 */
export function defaultRenewalStartDate(currentEndDate: string, today: string): string {
  const anchor = maxDate(currentEndDate, addDays(today, -1));
  return addDays(anchor, 1);
}

export function daysRemaining(endDate: string, today: string): number {
  return diffDays(today, endDate);
}
