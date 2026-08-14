import { describe, it, expect } from 'vitest';
import {
  computeEndDate,
  graceEndDate,
  freezeExtensionDays,
  applyFreezeExtension,
  defaultRenewalStartDate,
  daysRemaining,
} from '../src/membership-dates.js';

describe('computeEndDate', () => {
  it('1-month plan from the 1st ends on last day of month', () => {
    expect(computeEndDate({ startDate: '2026-06-01', durationUnit: 'months', durationValue: 1 })).toBe(
      '2026-06-30',
    );
  });
  it('3-month plan from mid-month', () => {
    expect(computeEndDate({ startDate: '2026-06-15', durationUnit: 'months', durationValue: 3 })).toBe(
      '2026-09-14',
    );
  });
  it('6-month plan 01-Jun → 30-Nov (matches the spec example)', () => {
    expect(computeEndDate({ startDate: '2026-06-01', durationUnit: 'months', durationValue: 6 })).toBe(
      '2026-11-30',
    );
  });
  it('12-month plan spans the year', () => {
    expect(computeEndDate({ startDate: '2026-01-15', durationUnit: 'months', durationValue: 12 })).toBe(
      '2027-01-14',
    );
  });
  it('handles Jan 31 start (end-of-month clamp)', () => {
    // 31-Jan + 1 month clamps to 28-Feb; end = 27-Feb
    expect(computeEndDate({ startDate: '2026-01-31', durationUnit: 'months', durationValue: 1 })).toBe(
      '2026-02-27',
    );
  });
  it('leap year: 1 month from 30-Jan-2028 ends 28-Feb-2028', () => {
    expect(computeEndDate({ startDate: '2028-01-30', durationUnit: 'months', durationValue: 1 })).toBe(
      '2028-02-28',
    );
  });
  it('day-based plans count the start day', () => {
    expect(computeEndDate({ startDate: '2026-06-01', durationUnit: 'days', durationValue: 1 })).toBe(
      '2026-06-01', // 1-day trial ends same day
    );
    expect(computeEndDate({ startDate: '2026-06-01', durationUnit: 'days', durationValue: 7 })).toBe(
      '2026-06-07',
    );
  });
  it('rejects non-positive durations', () => {
    expect(() =>
      computeEndDate({ startDate: '2026-06-01', durationUnit: 'months', durationValue: 0 }),
    ).toThrow();
  });
});

describe('grace period', () => {
  it('adds days after expiry', () => {
    expect(graceEndDate('2026-06-30', 3)).toBe('2026-07-03');
    expect(graceEndDate('2026-06-30', 0)).toBe('2026-06-30');
  });
});

describe('freeze extension', () => {
  it('computes days between freeze start and end', () => {
    expect(freezeExtensionDays('2026-06-01', '2026-06-16')).toBe(15);
  });
  it('same-day unfreeze still counts one day', () => {
    expect(freezeExtensionDays('2026-06-01', '2026-06-01')).toBe(1);
  });
  it('extends expiry by freeze days', () => {
    expect(applyFreezeExtension('2026-08-31', 15)).toBe('2026-09-15');
  });
  it('15-day freeze pushes a 30-Jun expiry to 15-Jul (scenario 3)', () => {
    const ext = freezeExtensionDays('2026-06-10', '2026-06-25');
    expect(ext).toBe(15);
    expect(applyFreezeExtension('2026-06-30', ext)).toBe('2026-07-15');
  });
});

describe('defaultRenewalStartDate', () => {
  it('renewing before expiry continues seamlessly', () => {
    expect(defaultRenewalStartDate('2026-06-30', '2026-06-25')).toBe('2026-07-01');
  });
  it('renewing on expiry day continues next day', () => {
    expect(defaultRenewalStartDate('2026-06-30', '2026-06-30')).toBe('2026-07-01');
  });
  it('renewing after expiry starts today', () => {
    expect(defaultRenewalStartDate('2026-06-30', '2026-07-10')).toBe('2026-07-10');
  });
});

describe('daysRemaining', () => {
  it('positive before expiry, negative after', () => {
    expect(daysRemaining('2026-11-30', '2026-08-14')).toBe(108);
    expect(daysRemaining('2026-06-30', '2026-07-02')).toBe(-2);
  });
});
