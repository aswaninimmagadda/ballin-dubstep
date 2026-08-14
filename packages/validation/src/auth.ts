import { z } from 'zod';
import { indianMobileSchema } from './primitives.js';

export const staffLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(200),
});

export const memberLoginSchema = z.object({
  /** Tenant slug scopes the login — the same mobile can exist at two gyms. */
  gymCode: z.string().trim().toLowerCase().min(2).max(40),
  mobile: indianMobileSchema,
  password: z.string().min(6).max(200),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z
      .string()
      .min(10, 'Use at least 10 characters')
      .max(200)
      .refine((p) => !/^(.)\1+$/.test(p), 'Password is too repetitive'),
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'New password must be different',
    path: ['newPassword'],
  });

export const setMemberPasswordSchema = z.object({
  memberId: z.string().uuid(),
  password: z.string().min(6).max(200),
});
