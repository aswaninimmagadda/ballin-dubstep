import { z } from 'zod';
import { isValidIndianMobile, normalizeIndianMobile } from '@gymflow/utils';

export const uuidSchema = z.string().uuid();

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine((d) => {
    const [y, m, day] = d.split('-').map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, day));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === day;
  }, 'Not a real calendar date');

/** Accepts any common Indian mobile shape; transforms to E.164. */
export const indianMobileSchema = z
  .string()
  .trim()
  .refine(isValidIndianMobile, 'Enter a valid 10-digit Indian mobile number')
  .transform((v) => normalizeIndianMobile(v).e164);

/**
 * A contact number that is NOT a login identity — an emergency contact is
 * often a landline or a relative's number in another format. Kept permissive
 * on purpose: rejecting these at the desk blocks onboarding for no benefit,
 * since nothing authenticates against this field.
 */
export const contactPhoneSchema = z
  .string()
  .trim()
  .min(6, 'Enter a contact number')
  .max(20)
  .refine((v) => /^[+\d][\d\s-]{5,19}$/.test(v), 'Use digits, spaces or dashes only');

/** Money entered in the UI as rupees; API carries integer minor units. */
export const minorUnitsSchema = z.number().int().nonnegative().safe();

export const pinCodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit PIN code');

export const languageSchema = z.enum(['en', 'te']);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** Free-text fields: trimmed, bounded, never unbounded blobs. */
export const shortText = z.string().trim().min(1).max(120);
export const mediumText = z.string().trim().max(500);
export const longText = z.string().trim().max(2000);
