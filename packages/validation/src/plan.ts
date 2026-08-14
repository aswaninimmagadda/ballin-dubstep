import { z } from 'zod';
import { isoDateSchema, mediumText, minorUnitsSchema, shortText, uuidSchema } from './primitives.js';

export const planTermsSchema = z.object({
  durationUnit: z.enum(['days', 'months']),
  durationValue: z.number().int().min(1).max(3650),
  basePrice: minorUnitsSchema,
  joiningFee: minorUnitsSchema.default(0),
  taxRateBps: z.number().int().min(0).max(10000).default(0),
  taxInclusive: z.boolean().default(true),
  freezeAllowanceDays: z.number().int().min(0).max(365).default(0),
  maxFreezes: z.number().int().min(0).max(12).default(0),
  gracePeriodDays: z.number().int().min(0).max(60).default(3),
  allowedTimings: z.string().trim().max(60).optional().nullable(),
  maxVisitsPerMonth: z.number().int().min(1).max(100).optional().nullable(),
  branchIds: z.array(uuidSchema).optional().nullable(),
  eligibilityNote: mediumText.optional().nullable(),
});

export const createPlanSchema = z.object({
  name: shortText,
  publicDescription: mediumText.optional().nullable(),
  internalDescription: mediumText.optional().nullable(),
  displayOrder: z.number().int().min(0).default(0),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  effectiveFrom: isoDateSchema.optional().nullable(),
  effectiveTo: isoDateSchema.optional().nullable(),
  terms: planTermsSchema,
});

export type CreatePlanInput = z.infer<typeof createPlanSchema>;

/** Updating terms always creates a new plan version; the old version stays. */
export const updatePlanTermsSchema = z.object({
  planId: uuidSchema,
  terms: planTermsSchema,
});
