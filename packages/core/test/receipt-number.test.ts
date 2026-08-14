import { describe, it, expect } from 'vitest';
import {
  fiscalYearLabel,
  formatReceiptNumber,
  formatMembershipNumber,
} from '../src/receipt-number';

describe('fiscalYearLabel (Indian FY: Apr–Mar)', () => {
  it('April onwards belongs to the same year', () => {
    expect(fiscalYearLabel('2026-04-01')).toBe('2026');
    expect(fiscalYearLabel('2026-12-31')).toBe('2026');
  });
  it('Jan–Mar belongs to the previous year', () => {
    expect(fiscalYearLabel('2026-03-31')).toBe('2025');
    expect(fiscalYearLabel('2027-01-15')).toBe('2026');
  });
});

describe('formatReceiptNumber', () => {
  it('matches the documented format', () => {
    expect(formatReceiptNumber({ prefix: 'GYM', fiscalYear: '2026', sequence: 123 })).toBe(
      'GYM-2026-000123',
    );
  });
  it('rejects non-positive sequences', () => {
    expect(() => formatReceiptNumber({ prefix: 'GYM', fiscalYear: '2026', sequence: 0 })).toThrow();
  });
});

describe('formatMembershipNumber', () => {
  it('pads', () => {
    expect(formatMembershipNumber('M', 45)).toBe('M0045');
  });
});
