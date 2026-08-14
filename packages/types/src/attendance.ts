import type { UUID, ISODateTime } from './ids.js';

export type CheckinMethod = 'reception' | 'qr' | 'manual';

export interface Attendance {
  id: UUID;
  tenantId: UUID;
  branchId: UUID;
  memberId: UUID;
  method: CheckinMethod;
  checkedInAt: ISODateTime;
  checkedInBy: UUID | null; // staff user for reception check-ins
  deviceInfo: string | null;
}
