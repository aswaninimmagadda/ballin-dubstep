import type { UUID, ISODateTime } from './ids';

export interface AuditLog {
  id: UUID;
  tenantId: UUID | null; // null for platform-level actions
  actorId: UUID | null;
  actorLabel: string; // denormalized display name, survives user deletion
  action: string; // e.g. "member.create", "payment.refund"
  entityType: string;
  entityId: UUID | null;
  /** Redacted before/after snapshots. Never contains secrets or full PII dumps. */
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: ISODateTime;
}
