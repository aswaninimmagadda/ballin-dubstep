import type { UUID, ISODate, ISODateTime } from './ids.js';

export type LeadSource =
  | 'walk_in'
  | 'phone'
  | 'whatsapp'
  | 'social'
  | 'referral'
  | 'website'
  | 'other';

export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'trial_scheduled'
  | 'trial_completed'
  | 'interested'
  | 'follow_up'
  | 'won'
  | 'lost';

export interface Lead {
  id: UUID;
  tenantId: UUID;
  branchId: UUID;
  name: string;
  mobile: string;
  interestedPlanId: UUID | null;
  preferredTiming: string | null;
  source: LeadSource;
  assignedTo: UUID | null;
  followUpDate: ISODate | null;
  notes: string | null;
  status: LeadStatus;
  convertedMemberId: UUID | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface LeadActivity {
  id: UUID;
  tenantId: UUID;
  leadId: UUID;
  kind: 'note' | 'call' | 'whatsapp' | 'visit' | 'status_change';
  detail: string | null;
  actorId: UUID | null;
  createdAt: ISODateTime;
}
