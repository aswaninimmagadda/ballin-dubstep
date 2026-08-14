import { compareDates } from '@gymflow/utils';
import type { Promotion } from '@gymflow/types';

export interface PromotionContext {
  today: string;
  planId: string;
  branchId: string;
  isRenewal: boolean;
  isNewMember: boolean;
  memberRedemptionCount: number;
  totalRedemptionCount: number;
}

export type PromotionRejection =
  | 'inactive'
  | 'not_started'
  | 'ended'
  | 'plan_not_applicable'
  | 'branch_not_applicable'
  | 'audience_mismatch'
  | 'usage_limit_reached'
  | 'per_member_limit_reached';

export interface EligibilityResult {
  eligible: boolean;
  reason?: PromotionRejection;
}

export function checkPromotionEligibility(
  promo: Pick<
    Promotion,
    | 'isActive'
    | 'validFrom'
    | 'validTo'
    | 'planIds'
    | 'branchIds'
    | 'audience'
    | 'usageLimit'
    | 'perMemberLimit'
  >,
  ctx: PromotionContext,
): EligibilityResult {
  if (!promo.isActive) return { eligible: false, reason: 'inactive' };
  if (compareDates(ctx.today, promo.validFrom) < 0) return { eligible: false, reason: 'not_started' };
  if (compareDates(ctx.today, promo.validTo) > 0) return { eligible: false, reason: 'ended' };
  if (promo.planIds && !promo.planIds.includes(ctx.planId)) {
    return { eligible: false, reason: 'plan_not_applicable' };
  }
  if (promo.branchIds && !promo.branchIds.includes(ctx.branchId)) {
    return { eligible: false, reason: 'branch_not_applicable' };
  }
  if (promo.audience === 'new_members' && !ctx.isNewMember) {
    return { eligible: false, reason: 'audience_mismatch' };
  }
  if (promo.audience === 'renewals' && !ctx.isRenewal) {
    return { eligible: false, reason: 'audience_mismatch' };
  }
  if (promo.usageLimit != null && ctx.totalRedemptionCount >= promo.usageLimit) {
    return { eligible: false, reason: 'usage_limit_reached' };
  }
  if (promo.perMemberLimit != null && ctx.memberRedemptionCount >= promo.perMemberLimit) {
    return { eligible: false, reason: 'per_member_limit_reached' };
  }
  return { eligible: true };
}
