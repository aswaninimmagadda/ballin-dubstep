import { describe, it, expect } from 'vitest';
import {
  addMoney,
  applyDiscount,
  computeTax,
  formatMoney,
  parseMoney,
  percentOf,
  MoneyError,
} from '../src/money';

describe('money integer safety', () => {
  it('rejects floats', () => {
    expect(() => addMoney(100.5, 1)).toThrow(MoneyError);
    expect(() => percentOf(10.1, 100)).toThrow(MoneyError);
  });

  it('adds and rejects unsafe sums', () => {
    expect(addMoney(150000, 50000)).toBe(200000);
  });
});

describe('percentOf (basis points)', () => {
  it('computes simple percentages', () => {
    expect(percentOf(100000, 1000)).toBe(10000); // 10% of ₹1000
    expect(percentOf(100000, 1800)).toBe(18000); // 18% GST
  });
  it('rounds half-up on paise', () => {
    expect(percentOf(999, 1000)).toBe(100); // 99.9 -> 100
    expect(percentOf(994, 1000)).toBe(99); // 99.4 -> 99
    expect(percentOf(995, 1000)).toBe(100); // 99.5 -> 100 (half-up)
  });
  it('handles large amounts without overflow', () => {
    expect(percentOf(9_000_000_000_000, 1800)).toBe(1_620_000_000_000);
  });
});

describe('applyDiscount', () => {
  it('percentage discount', () => {
    expect(applyDiscount({ baseAmount: 300000, kind: 'percentage', value: 1000 })).toEqual({
      discount: 30000,
      payable: 270000,
    });
  });
  it('flat discount', () => {
    expect(applyDiscount({ baseAmount: 300000, kind: 'flat', value: 50000 })).toEqual({
      discount: 50000,
      payable: 250000,
    });
  });
  it('discount greater than base clamps to base (never negative payable)', () => {
    expect(applyDiscount({ baseAmount: 100000, kind: 'flat', value: 150000 })).toEqual({
      discount: 100000,
      payable: 0,
    });
  });
  it('respects maxDiscountAmount', () => {
    expect(
      applyDiscount({ baseAmount: 1000000, kind: 'percentage', value: 5000, maxDiscountAmount: 100000 }),
    ).toEqual({ discount: 100000, payable: 900000 });
  });
  it('joining fee waiver discounts exactly the joining fee', () => {
    expect(
      applyDiscount({ baseAmount: 350000, kind: 'joining_fee_waiver', value: 0, joiningFee: 50000 }),
    ).toEqual({ discount: 50000, payable: 300000 });
  });
  it('zero-price membership stays zero', () => {
    expect(applyDiscount({ baseAmount: 0, kind: 'percentage', value: 5000 })).toEqual({
      discount: 0,
      payable: 0,
    });
  });
});

describe('computeTax', () => {
  it('exclusive tax adds on top', () => {
    expect(computeTax(100000, 1800, false)).toEqual({ net: 100000, tax: 18000, gross: 118000 });
  });
  it('inclusive tax splits out net', () => {
    const r = computeTax(118000, 1800, true);
    expect(r.gross).toBe(118000);
    expect(r.net).toBe(100000);
    expect(r.tax).toBe(18000);
  });
  it('inclusive split always sums back to gross', () => {
    for (const gross of [1, 99, 100001, 12345678]) {
      const r = computeTax(gross, 1800, true);
      expect(r.net + r.tax).toBe(r.gross);
    }
  });
  it('zero rate is passthrough', () => {
    expect(computeTax(5000, 0, true)).toEqual({ net: 5000, tax: 0, gross: 5000 });
  });
});

describe('formatMoney / parseMoney', () => {
  it('formats INR lakhs style', () => {
    expect(formatMoney(15000000)).toContain('1,50,000');
  });
  it('shows paise only when nonzero', () => {
    expect(formatMoney(150050)).toContain('.50');
    expect(formatMoney(150000)).not.toContain('.');
  });
  it('parses common user input', () => {
    expect(parseMoney('1500')).toBe(150000);
    expect(parseMoney('₹1,500.50')).toBe(150050);
    expect(parseMoney('1500.5')).toBe(150050);
  });
  it('rejects garbage', () => {
    expect(() => parseMoney('12.345')).toThrow(MoneyError);
    expect(() => parseMoney('abc')).toThrow(MoneyError);
    expect(() => parseMoney('-100')).toThrow(MoneyError);
  });
});
