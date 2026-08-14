import type { UUID, ISODate, ISODateTime, MinorUnits } from './ids';

export type PlanDurationUnit = 'days' | 'months';

/**
 * A sellable membership plan. Pricing/terms changes create a new
 * `MembershipPlanVersion`; memberships snapshot the version they were sold
 * under so history is never rewritten.
 */
export interface MembershipPlan {
  id: UUID;
  tenantId: UUID;
  name: string;
  publicDescription: string | null;
  internalDescription: string | null;
  isActive: boolean;
  displayOrder: number;
  tags: string[];
  effectiveFrom: ISODate | null;
  effectiveTo: ISODate | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface MembershipPlanVersion {
  id: UUID;
  tenantId: UUID;
  planId: UUID;
  version: number;
  durationUnit: PlanDurationUnit;
  durationValue: number;
  basePrice: MinorUnits;
  joiningFee: MinorUnits;
  taxRateBps: number; // basis points, e.g. 1800 = 18%
  taxInclusive: boolean;
  freezeAllowanceDays: number;
  maxFreezes: number;
  gracePeriodDays: number;
  allowedTimings: string | null; // e.g. "05:00-11:00", null = any
  maxVisitsPerMonth: number | null;
  branchIds: UUID[] | null; // null = all branches
  eligibilityNote: string | null;
  createdAt: ISODateTime;
}

export type AddonKind =
  | 'personal_training'
  | 'group_class'
  | 'locker'
  | 'towel'
  | 'nutrition'
  | 'other';

export interface AddonPackage {
  id: UUID;
  tenantId: UUID;
  kind: AddonKind;
  name: string;
  description: string | null;
  sessionCount: number | null; // null = unlimited within validity
  validityDays: number;
  price: MinorUnits;
  isActive: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}
