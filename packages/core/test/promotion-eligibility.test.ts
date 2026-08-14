import { describe, it, expect } from 'vitest';
import { checkPromotionEligibility, type PromotionContext } from '../src/promotion-eligibility';

const promo = {
  isActive: true,
  validFrom: '2026-01-01',
  validTo: '2026-01-31',
  planIds: null,
  branchIds: null,
  audience: 'all' as const,
  usageLimit: null,
  perMemberLimit: 1,
};

const ctx: PromotionContext = {
  today: '2026-01-15',
  planId: 'plan-1',
  branchId: 'branch-1',
  isRenewal: false,
  isNewMember: true,
  memberRedemptionCount: 0,
  totalRedemptionCount: 10,
};

describe('checkPromotionEligibility', () => {
  it('accepts a valid promo', () => {
    expect(checkPromotionEligibility(promo, ctx)).toEqual({ eligible: true });
  });
  it('rejects expired promotion', () => {
    expect(checkPromotionEligibility(promo, { ...ctx, today: '2026-02-01' })).toEqual({
      eligible: false,
      reason: 'ended',
    });
  });
  it('rejects before start', () => {
    expect(checkPromotionEligibility(promo, { ...ctx, today: '2025-12-31' }).reason).toBe(
      'not_started',
    );
  });
  it('rejects inactive', () => {
    expect(checkPromotionEligibility({ ...promo, isActive: false }, ctx).reason).toBe('inactive');
  });
  it('enforces plan and branch applicability', () => {
    expect(
      checkPromotionEligibility({ ...promo, planIds: ['other-plan'] }, ctx).reason,
    ).toBe('plan_not_applicable');
    expect(
      checkPromotionEligibility({ ...promo, branchIds: ['other-branch'] }, ctx).reason,
    ).toBe('branch_not_applicable');
  });
  it('enforces audience', () => {
    expect(
      checkPromotionEligibility({ ...promo, audience: 'renewals' }, ctx).reason,
    ).toBe('audience_mismatch');
    expect(
      checkPromotionEligibility({ ...promo, audience: 'new_members' }, { ...ctx, isNewMember: false })
        .reason,
    ).toBe('audience_mismatch');
  });
  it('enforces usage limits', () => {
    expect(
      checkPromotionEligibility({ ...promo, usageLimit: 10 }, ctx).reason,
    ).toBe('usage_limit_reached');
    expect(
      checkPromotionEligibility(promo, { ...ctx, memberRedemptionCount: 1 }).reason,
    ).toBe('per_member_limit_reached');
  });
});
