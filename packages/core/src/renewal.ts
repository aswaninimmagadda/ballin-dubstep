import type { PlanDurationUnit } from '@gymflow/types';
import { computeEndDate, defaultRenewalStartDate } from './membership-dates';

export interface RenewalProposal {
  startDate: string;
  endDate: string;
}

/**
 * Propose a renewal period. Staff see this before confirming; the same
 * function runs server-side at confirmation so the preview can never drift
 * from what is written.
 */
export function proposeRenewal(opts: {
  currentEndDate: string;
  today: string;
  durationUnit: PlanDurationUnit;
  durationValue: number;
  /** Explicit override start (e.g. backdated or future-dated renewal). */
  overrideStartDate?: string;
}): RenewalProposal {
  const startDate =
    opts.overrideStartDate ?? defaultRenewalStartDate(opts.currentEndDate, opts.today);
  const endDate = computeEndDate({
    startDate,
    durationUnit: opts.durationUnit,
    durationValue: opts.durationValue,
  });
  return { startDate, endDate };
}
