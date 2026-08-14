import { z } from 'zod';
import { isoDateSchema, mediumText, minorUnitsSchema, uuidSchema } from './primitives.js';

export const recordPaymentSchema = z.object({
  memberId: uuidSchema,
  membershipId: uuidSchema.optional().nullable(),
  memberAddonId: uuidSchema.optional().nullable(),
  amount: minorUnitsSchema.refine((v) => v > 0, 'Amount must be greater than zero'),
  method: z.enum(['cash', 'upi', 'card_credit', 'card_debit', 'bank_transfer', 'other']),
  externalReference: z.string().trim().max(120).optional().nullable(),
  paymentDate: isoDateSchema.optional(),
  notes: mediumText.optional().nullable(),
  idempotencyKey: z.string().min(8).max(64),
});

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const refundPaymentSchema = z.object({
  paymentId: uuidSchema,
  amount: minorUnitsSchema.refine((v) => v > 0, 'Amount must be greater than zero'),
  reason: z.string().trim().min(3).max(500),
});
