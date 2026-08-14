import type { UUID, ISODate, ISODateTime, MinorUnits } from './ids.js';

/**
 * Commercial state of one sold membership period. A member accumulates many
 * memberships over time (renewals create new rows; history is immutable).
 */
export type MembershipState =
  | 'pending' // sold, starts in the future
  | 'active'
  | 'frozen'
  | 'cancelled'
  | 'expired';

export interface Membership {
  id: UUID;
  tenantId: UUID;
  branchId: UUID;
  memberId: UUID;
  planId: UUID;
  planVersionId: UUID;
  /** Snapshot of the plan name at time of sale — survives plan renames. */
  planNameSnapshot: string;
  startDate: ISODate;
  /** Expiry as originally computed from start + duration. */
  baseEndDate: ISODate;
  /** Effective expiry after freeze extensions. */
  endDate: ISODate;
  gracePeriodDays: number;
  state: MembershipState;
  /** Total price agreed at sale (after discount, incl. tax), minor units. */
  totalAmount: MinorUnits;
  discountAmount: MinorUnits;
  promotionId: UUID | null;
  soldBy: UUID | null;
  previousMembershipId: UUID | null; // renewal chain
  cancelledAt: ISODateTime | null;
  cancelReason: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type MembershipEventType =
  | 'sold'
  | 'activated'
  | 'renewed'
  | 'frozen'
  | 'unfrozen'
  | 'cancelled'
  | 'expired'
  | 'extended'
  | 'transferred';

export interface MembershipEvent {
  id: UUID;
  tenantId: UUID;
  membershipId: UUID;
  type: MembershipEventType;
  data: Record<string, unknown>;
  actorId: UUID | null;
  createdAt: ISODateTime;
}

export interface MembershipFreeze {
  id: UUID;
  tenantId: UUID;
  membershipId: UUID;
  startDate: ISODate;
  /** Planned end; null while open-ended (medical). */
  plannedEndDate: ISODate | null;
  actualEndDate: ISODate | null;
  days: number | null; // resolved when unfrozen
  reason: string;
  note: string | null;
  extendsExpiry: boolean;
  authorizedBy: UUID;
  createdAt: ISODateTime;
}

export interface MemberAddon {
  id: UUID;
  tenantId: UUID;
  memberId: UUID;
  addonPackageId: UUID;
  nameSnapshot: string;
  priceSnapshot: MinorUnits;
  trainerId: UUID | null;
  sessionsTotal: number | null;
  sessionsUsed: number;
  startDate: ISODate;
  endDate: ISODate;
  state: 'active' | 'completed' | 'expired' | 'cancelled';
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}
