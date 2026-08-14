import type { UUID, ISODate, ISODateTime, MinorUnits } from './ids';

export type PaymentMethod =
  'cash' | 'upi' | 'card_credit' | 'card_debit' | 'bank_transfer' | 'other';

export type PaymentStatus = 'completed' | 'pending' | 'failed' | 'refunded' | 'partially_refunded';

/**
 * Immutable payment record. Corrections are made by refunds/adjustments,
 * never by editing or deleting rows.
 */
export interface Payment {
  id: UUID;
  tenantId: UUID;
  branchId: UUID;
  memberId: UUID;
  amount: MinorUnits;
  method: PaymentMethod;
  status: PaymentStatus;
  paymentDate: ISODate;
  /** UPI/bank reference entered by staff for manual payments. */
  externalReference: string | null;
  receivedBy: UUID | null;
  notes: string | null;
  /** Client-supplied idempotency key: retries never double-record. */
  idempotencyKey: string | null;
  createdAt: ISODateTime;
}

export interface PaymentAllocation {
  id: UUID;
  tenantId: UUID;
  paymentId: UUID;
  membershipId: UUID | null;
  memberAddonId: UUID | null;
  amount: MinorUnits;
  createdAt: ISODateTime;
}

export interface Refund {
  id: UUID;
  tenantId: UUID;
  paymentId: UUID;
  amount: MinorUnits;
  reason: string;
  approvedBy: UUID;
  processedBy: UUID;
  createdAt: ISODateTime;
}

export interface Receipt {
  id: UUID;
  tenantId: UUID;
  branchId: UUID;
  paymentId: UUID;
  /** e.g. GYM-2026-000123 — tenant-configurable, concurrency safe. */
  receiptNumber: string;
  sequence: number;
  fiscalYearLabel: string;
  createdAt: ISODateTime;
}
