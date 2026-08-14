import type { UUID, ISODate, ISODateTime, MinorUnits } from './ids.js';

export type DiscountKind = 'percentage' | 'flat' | 'joining_fee_waiver';

export type PromotionAudience = 'all' | 'new_members' | 'renewals' | 'win_back';

export interface Promotion {
  id: UUID;
  tenantId: UUID;
  code: string;
  name: string;
  autoApply: boolean;
  discountKind: DiscountKind;
  /** Percentage in basis points (1000 = 10%) or flat minor units. */
  discountValue: number;
  maxDiscountAmount: MinorUnits | null;
  validFrom: ISODate;
  validTo: ISODate;
  planIds: UUID[] | null; // null = all plans
  branchIds: UUID[] | null; // null = all branches
  usageLimit: number | null;
  perMemberLimit: number | null;
  audience: PromotionAudience;
  isActive: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface PromotionRedemption {
  id: UUID;
  tenantId: UUID;
  promotionId: UUID;
  memberId: UUID;
  membershipId: UUID;
  discountAmount: MinorUnits;
  createdAt: ISODateTime;
}
