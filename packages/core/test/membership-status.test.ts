import { describe, it, expect } from 'vitest';
import { deriveMembershipStatus, allowsCheckin } from '../src/membership-status.js';

const base = {
  state: 'active' as const,
  startDate: '2026-06-01',
  endDate: '2026-08-31',
  gracePeriodDays: 3,
};

describe('deriveMembershipStatus', () => {
  it('pending before start', () => {
    expect(deriveMembershipStatus(base, '2026-05-20')).toBe('pending');
  });
  it('active in the middle', () => {
    expect(deriveMembershipStatus(base, '2026-07-01')).toBe('active');
  });
  it('expiring soon within threshold', () => {
    expect(deriveMembershipStatus(base, '2026-08-25')).toBe('expiring_soon');
    expect(deriveMembershipStatus(base, '2026-08-31')).toBe('expiring_soon');
  });
  it('grace period right after expiry', () => {
    expect(deriveMembershipStatus(base, '2026-09-01')).toBe('grace_period');
    expect(deriveMembershipStatus(base, '2026-09-03')).toBe('grace_period');
  });
  it('expired after grace', () => {
    expect(deriveMembershipStatus(base, '2026-09-04')).toBe('expired');
  });
  it('frozen and cancelled override dates', () => {
    expect(deriveMembershipStatus({ ...base, state: 'frozen' }, '2026-07-01')).toBe('frozen');
    expect(deriveMembershipStatus({ ...base, state: 'cancelled' }, '2026-07-01')).toBe('cancelled');
  });
  it('zero grace goes straight to expired', () => {
    expect(deriveMembershipStatus({ ...base, gracePeriodDays: 0 }, '2026-09-01')).toBe('expired');
  });
});

describe('allowsCheckin', () => {
  it('permits active/expiring/grace, blocks others', () => {
    expect(allowsCheckin('active')).toBe(true);
    expect(allowsCheckin('expiring_soon')).toBe(true);
    expect(allowsCheckin('grace_period')).toBe(true);
    expect(allowsCheckin('expired')).toBe(false);
    expect(allowsCheckin('frozen')).toBe(false);
    expect(allowsCheckin('pending')).toBe(false);
    expect(allowsCheckin('cancelled')).toBe(false);
  });
});
