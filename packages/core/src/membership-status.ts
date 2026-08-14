import { compareDates } from '@gymflow/utils';
import { graceEndDate, daysRemaining } from './membership-dates';

/**
 * Derived, display-oriented membership state. The database stores the
 * commercial state ('active' | 'frozen' | 'cancelled' | ...); time-derived
 * refinements (expiring soon, in grace, expired) are computed, never stored,
 * so they can't go stale overnight.
 */
export type DerivedMembershipStatus =
  | 'pending'
  | 'active'
  | 'expiring_soon'
  | 'grace_period'
  | 'frozen'
  | 'cancelled'
  | 'expired';

export interface MembershipSnapshot {
  state: 'pending' | 'active' | 'frozen' | 'cancelled' | 'expired';
  startDate: string;
  endDate: string;
  gracePeriodDays: number;
}

export function deriveMembershipStatus(
  m: MembershipSnapshot,
  today: string,
  expiringSoonDays = 7,
): DerivedMembershipStatus {
  if (m.state === 'cancelled') return 'cancelled';
  if (m.state === 'frozen') return 'frozen';
  if (compareDates(today, m.startDate) < 0) return 'pending';
  const remaining = daysRemaining(m.endDate, today);
  if (remaining < 0) {
    const graceEnd = graceEndDate(m.endDate, m.gracePeriodDays);
    if (compareDates(today, graceEnd) <= 0) return 'grace_period';
    return 'expired';
  }
  if (remaining <= expiringSoonDays) return 'expiring_soon';
  return 'active';
}

/** True when the member should be allowed into the gym today. */
export function allowsCheckin(status: DerivedMembershipStatus): boolean {
  return status === 'active' || status === 'expiring_soon' || status === 'grace_period';
}
