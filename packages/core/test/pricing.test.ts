import { describe, it, expect } from 'vitest';
import { quoteMembership } from '../src/pricing';

const planVersion = {
  basePrice: 300000, // ₹3000
  joiningFee: 50000, // ₹500
  taxRateBps: 0,
  taxInclusive: true,
};

describe('quoteMembership', () => {
  it('plain sale with joining fee', () => {
    const q = quoteMembership({ planVersion, planName: '3 Month', includeJoiningFee: true });
    expect(q.subtotal).toBe(350000);
    expect(q.total).toBe(350000);
  });
  it('renewal without joining fee', () => {
    const q = quoteMembership({ planVersion, planName: '3 Month', includeJoiningFee: false });
    expect(q.total).toBe(300000);
  });
  it('percentage promotion', () => {
    const q = quoteMembership({
      planVersion,
      planName: '3 Month',
      includeJoiningFee: false,
      promotion: { discountKind: 'percentage', discountValue: 1000, maxDiscountAmount: null },
    });
    expect(q.discount).toBe(30000);
    expect(q.total).toBe(270000);
  });
  it('joining fee waiver only waives the fee', () => {
    const q = quoteMembership({
      planVersion,
      planName: '3 Month',
      includeJoiningFee: true,
      promotion: { discountKind: 'joining_fee_waiver', discountValue: 0, maxDiscountAmount: null },
    });
    expect(q.discount).toBe(50000);
    expect(q.total).toBe(300000);
  });
  it('discount larger than subtotal clamps to zero payable', () => {
    const q = quoteMembership({
      planVersion,
      planName: '3 Month',
      includeJoiningFee: false,
      promotion: { discountKind: 'flat', discountValue: 999999, maxDiscountAmount: null },
    });
    expect(q.total).toBe(0);
  });
  it('exclusive tax added after discount', () => {
    const q = quoteMembership({
      planVersion: { ...planVersion, taxRateBps: 1800, taxInclusive: false },
      planName: '3 Month',
      includeJoiningFee: false,
      promotion: { discountKind: 'flat', discountValue: 100000, maxDiscountAmount: null },
    });
    expect(q.discount).toBe(100000);
    expect(q.tax).toBe(36000); // 18% of 2,00,000
    expect(q.total).toBe(236000);
  });
});
