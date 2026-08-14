import { describe, it, expect } from 'vitest';
import { proposeRenewal } from '../src/renewal';

describe('proposeRenewal', () => {
  it('seamless renewal before expiry (6-month renewal scenario)', () => {
    expect(
      proposeRenewal({
        currentEndDate: '2026-06-30',
        today: '2026-06-25',
        durationUnit: 'months',
        durationValue: 6,
      }),
    ).toEqual({ startDate: '2026-07-01', endDate: '2026-12-31' });
  });
  it('lapsed renewal starts today', () => {
    expect(
      proposeRenewal({
        currentEndDate: '2026-06-30',
        today: '2026-08-14',
        durationUnit: 'months',
        durationValue: 3,
      }),
    ).toEqual({ startDate: '2026-08-14', endDate: '2026-11-13' });
  });
  it('explicit override start is respected (future-dated renewal)', () => {
    expect(
      proposeRenewal({
        currentEndDate: '2026-06-30',
        today: '2026-06-25',
        durationUnit: 'months',
        durationValue: 1,
        overrideStartDate: '2026-08-01',
      }),
    ).toEqual({ startDate: '2026-08-01', endDate: '2026-08-31' });
  });
  it('end-of-month renewal edge: renew on 31-Jan for 1 month', () => {
    expect(
      proposeRenewal({
        currentEndDate: '2026-01-30',
        today: '2026-01-28',
        durationUnit: 'months',
        durationValue: 1,
      }),
    ).toEqual({ startDate: '2026-01-31', endDate: '2026-02-27' });
  });
});
