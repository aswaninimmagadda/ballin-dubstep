import { z } from 'zod';
import { isoDateSchema, mediumText, minorUnitsSchema, uuidSchema } from './primitives';

export const sellMembershipSchema = z.object({
  memberId: uuidSchema,
  planId: uuidSchema,
  startDate: isoDateSchema,
  includeJoiningFee: z.boolean().default(true),
  promotionCode: z.string().trim().max(40).optional().nullable(),
  manualDiscount: minorUnitsSchema.optional(),
  /** Idempotency key generated client-side; retries never double-sell. */
  idempotencyKey: z.string().min(8).max(64),
  payment: z
    .object({
      amount: minorUnitsSchema,
      method: z.enum(['cash', 'upi', 'card_credit', 'card_debit', 'bank_transfer', 'other']),
      externalReference: z.string().trim().max(120).optional().nullable(),
      paymentDate: isoDateSchema.optional(),
    })
    .optional(),
});

export type SellMembershipInput = z.infer<typeof sellMembershipSchema>;

export const renewMembershipSchema = sellMembershipSchema.extend({
  previousMembershipId: uuidSchema,
  overrideStartDate: isoDateSchema.optional(),
}).omit({ startDate: true });

export type RenewMembershipInput = z.infer<typeof renewMembershipSchema>;

export const freezeMembershipSchema = z.object({
  membershipId: uuidSchema,
  startDate: isoDateSchema,
  plannedEndDate: isoDateSchema.optional().nullable(),
  reason: z.string().trim().min(2).max(200),
  note: mediumText.optional().nullable(),
  extendsExpiry: z.boolean().default(true),
});

export const unfreezeMembershipSchema = z.object({
  membershipId: uuidSchema,
  actualEndDate: isoDateSchema,
});

export const cancelMembershipSchema = z.object({
  membershipId: uuidSchema,
  reason: z.string().trim().min(2).max(500),
});
