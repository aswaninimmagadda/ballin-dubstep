import { z } from 'zod';
import { indianMobileSchema, isoDateSchema } from './primitives';

/**
 * CSV member import row (migration from notebooks/Excel).
 * Amounts arrive as rupee strings and are converted to minor units by the
 * import service after validation.
 */
export const importMemberRowSchema = z.object({
  member_name: z.string().trim().min(1).max(200),
  mobile: indianMobileSchema,
  membership_plan: z.string().trim().min(1).max(120),
  start_date: isoDateSchema,
  expiry_date: isoDateSchema.optional().or(z.literal('')),
  amount_paid: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, 'Amount must be a number like 3000 or 3000.50')
    .optional()
    .or(z.literal('')),
  payment_method: z
    .enum(['cash', 'upi', 'card_credit', 'card_debit', 'bank_transfer', 'other'])
    .optional()
    .or(z.literal('')),
  trainer: z.string().trim().max(120).optional().or(z.literal('')),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
});

export type ImportMemberRow = z.infer<typeof importMemberRowSchema>;

export const IMPORT_TEMPLATE_HEADERS = [
  'member_name',
  'mobile',
  'membership_plan',
  'start_date',
  'expiry_date',
  'amount_paid',
  'payment_method',
  'trainer',
  'notes',
] as const;
