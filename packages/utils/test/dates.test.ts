import { describe, it, expect } from 'vitest';
import {
  addDays,
  addMonthsClamped,
  assertISODate,
  compareDates,
  DateError,
  diffDays,
  formatDisplayDate,
  maxDate,
  todayInTz,
} from '../src/dates';

describe('assertISODate', () => {
  it('accepts valid dates', () => {
    expect(assertISODate('2026-02-28')).toBe('2026-02-28');
    expect(assertISODate('2028-02-29')).toBe('2028-02-29'); // leap year
  });
  it('rejects impossible dates', () => {
    expect(() => assertISODate('2026-02-30')).toThrow(DateError);
    expect(() => assertISODate('2027-02-29')).toThrow(DateError); // not a leap year
    expect(() => assertISODate('2026-13-01')).toThrow(DateError);
    expect(() => assertISODate('01-06-2026')).toThrow(DateError);
  });
});

describe('addMonthsClamped — end of month and leap years', () => {
  it('normal month addition', () => {
    expect(addMonthsClamped('2026-06-15', 3)).toBe('2026-09-15');
  });
  it('clamps 31st into shorter months', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2026-03-31', 1)).toBe('2026-04-30');
    expect(addMonthsClamped('2026-08-31', 1)).toBe('2026-09-30');
  });
  it('handles leap-year February', () => {
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsClamped('2028-02-29', 12)).toBe('2029-02-28');
    expect(addMonthsClamped('2028-02-29', 48)).toBe('2032-02-29');
  });
  it('crosses year boundaries', () => {
    expect(addMonthsClamped('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonthsClamped('2026-12-31', 2)).toBe('2027-02-28');
  });
  it('supports 12-month annual plans', () => {
    expect(addMonthsClamped('2026-06-01', 12)).toBe('2027-06-01');
  });
});

describe('addDays / diffDays', () => {
  it('adds across month and year boundaries', () => {
    expect(addDays('2026-12-30', 5)).toBe('2027-01-04');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });
  it('diffDays symmetric', () => {
    expect(diffDays('2026-06-01', '2026-06-30')).toBe(29);
    expect(diffDays('2026-06-30', '2026-06-01')).toBe(-29);
  });
});

describe('compare/max', () => {
  it('orders dates', () => {
    expect(compareDates('2026-01-01', '2026-01-02')).toBe(-1);
    expect(compareDates('2026-01-02', '2026-01-02')).toBe(0);
    expect(maxDate('2026-05-01', '2026-04-30')).toBe('2026-05-01');
  });
});

describe('todayInTz', () => {
  it('IST date differs from UTC late at night', () => {
    // 2026-06-01T20:00:00Z is 2026-06-02 01:30 IST
    const now = new Date('2026-06-01T20:00:00Z');
    expect(todayInTz('Asia/Kolkata', now)).toBe('2026-06-02');
    expect(todayInTz('UTC', now)).toBe('2026-06-01');
  });
});

describe('formatDisplayDate', () => {
  it('formats Indian styles', () => {
    expect(formatDisplayDate('2026-06-01', 'DD-MM-YYYY')).toBe('01-06-2026');
    expect(formatDisplayDate('2026-06-01')).toBe('01-Jun-2026');
  });
});
