import { z } from 'zod';
import {
  indianMobileSchema,
  isoDateSchema,
  mediumText,
  pinCodeSchema,
  shortText,
  uuidSchema,
} from './primitives.js';

export const createMemberSchema = z.object({
  branchId: uuidSchema,
  firstName: shortText,
  lastName: z.string().trim().max(120).optional().nullable(),
  preferredName: z.string().trim().max(120).optional().nullable(),
  gender: z.enum(['male', 'female', 'other', 'undisclosed']).optional().nullable(),
  dateOfBirth: isoDateSchema.optional().nullable(),
  mobile: indianMobileSchema,
  altMobile: indianMobileSchema.optional().nullable(),
  email: z.string().trim().email().max(254).optional().nullable(),
  addressLine1: mediumText.optional().nullable(),
  village: z.string().trim().max(120).optional().nullable(),
  district: z.string().trim().max(120).optional().nullable(),
  state: z.string().trim().max(120).optional().nullable(),
  pinCode: pinCodeSchema.optional().nullable(),
  emergencyContactName: z.string().trim().max(120).optional().nullable(),
  emergencyContactRelation: z.string().trim().max(60).optional().nullable(),
  emergencyContactPhone: indianMobileSchema.optional().nullable(),
  joinDate: isoDateSchema.optional(),
  referralSource: z.string().trim().max(120).optional().nullable(),
  referredByMemberId: uuidSchema.optional().nullable(),
  assignedTrainerId: uuidSchema.optional().nullable(),
  notes: mediumText.optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});

export type CreateMemberInput = z.infer<typeof createMemberSchema>;

export const updateMemberSchema = createMemberSchema.partial().extend({
  id: uuidSchema,
});

export const memberSearchSchema = z.object({
  q: z.string().trim().max(120).default(''),
  status: z
    .enum([
      'lead', 'trial', 'pending_activation', 'active', 'frozen',
      'suspended', 'expired', 'cancelled', 'archived',
    ])
    .optional(),
  branchId: uuidSchema.optional(),
});
