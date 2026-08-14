import { z } from 'zod';
import { indianMobileSchema, isoDateSchema, mediumText, shortText, uuidSchema } from './primitives';

export const createLeadSchema = z.object({
  branchId: uuidSchema,
  name: shortText,
  mobile: indianMobileSchema,
  interestedPlanId: uuidSchema.optional().nullable(),
  preferredTiming: z.string().trim().max(120).optional().nullable(),
  source: z.enum(['walk_in', 'phone', 'whatsapp', 'social', 'referral', 'website', 'other']),
  assignedTo: uuidSchema.optional().nullable(),
  followUpDate: isoDateSchema.optional().nullable(),
  notes: mediumText.optional().nullable(),
});

export const updateLeadSchema = z.object({
  id: uuidSchema,
  status: z
    .enum([
      'new',
      'contacted',
      'trial_scheduled',
      'trial_completed',
      'interested',
      'follow_up',
      'won',
      'lost',
    ])
    .optional(),
  followUpDate: isoDateSchema.optional().nullable(),
  assignedTo: uuidSchema.optional().nullable(),
  notes: mediumText.optional().nullable(),
});
