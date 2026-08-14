import type { UUID, ISODate, ISODateTime } from './ids';

/**
 * Member lifecycle status. This is the *person's* relationship with the gym.
 * The commercial state of an individual membership lives on `Membership`.
 */
export type MemberStatus =
  | 'lead'
  | 'trial'
  | 'pending_activation'
  | 'active'
  | 'frozen'
  | 'suspended'
  | 'expired'
  | 'cancelled'
  | 'archived';

export type Gender = 'male' | 'female' | 'other' | 'undisclosed';

export interface Member {
  id: UUID;
  tenantId: UUID;
  branchId: UUID;
  userId: UUID | null; // linked login for the member app, if activated
  membershipNumber: string; // human-readable, tenant-configurable format
  firstName: string;
  lastName: string | null;
  preferredName: string | null;
  photoPath: string | null;
  gender: Gender | null;
  dateOfBirth: ISODate | null;
  mobile: string; // normalized E.164
  altMobile: string | null;
  email: string | null;
  addressLine1: string | null;
  village: string | null;
  district: string | null;
  state: string | null;
  pinCode: string | null;
  emergencyContactName: string | null;
  emergencyContactRelation: string | null;
  emergencyContactPhone: string | null;
  joinDate: ISODate;
  referralSource: string | null;
  referredByMemberId: UUID | null;
  assignedTrainerId: UUID | null;
  status: MemberStatus;
  notes: string | null;
  tags: string[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  archivedAt: ISODateTime | null;
}

export interface MemberStatusHistory {
  id: UUID;
  tenantId: UUID;
  memberId: UUID;
  fromStatus: MemberStatus | null;
  toStatus: MemberStatus;
  reason: string | null;
  changedBy: UUID | null;
  createdAt: ISODateTime;
}
