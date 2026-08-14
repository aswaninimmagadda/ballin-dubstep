import type { UUID, ISODate, ISODateTime } from './ids';

export interface Trainer {
  id: UUID;
  tenantId: UUID;
  branchId: UUID;
  userId: UUID | null; // trainer's staff login if they have one
  name: string;
  mobile: string;
  photoPath: string | null;
  specialization: string | null;
  certificationNote: string | null;
  isActive: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type SessionStatus =
  | 'scheduled'
  | 'completed'
  | 'cancelled'
  | 'member_no_show'
  | 'trainer_no_show';

export interface TrainerSession {
  id: UUID;
  tenantId: UUID;
  branchId: UUID;
  trainerId: UUID;
  memberId: UUID;
  memberAddonId: UUID | null;
  sessionDate: ISODate;
  startTime: string; // HH:MM
  endTime: string;
  status: SessionStatus;
  notes: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}
