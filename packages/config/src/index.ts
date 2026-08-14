/**
 * Product identity and platform defaults. The commercial name is a working
 * placeholder — rename here (and only here) when branding is decided.
 * Tenant-level branding (gym name, logo, colors) lives in the database, not
 * in code.
 */
export const PRODUCT = {
  /** Working name — configurable, never hard-code elsewhere. */
  name: 'GymFlow',
  shortName: 'GymFlow',
  description: 'Simple gym management for Indian gyms',
  version: '0.1.0',
} as const;

export const PLATFORM_DEFAULTS = {
  currency: 'INR',
  timezone: 'Asia/Kolkata',
  language: 'en' as const,
  dateFormat: 'DD-MM-YYYY',
  expiryReminderDays: [7, 3, 1],
  gracePeriodDays: 3,
  expiringSoonDays: 7,
  receiptPrefix: 'GYM',
  receiptSequencePadding: 6,
  membershipNumberPrefix: 'M',
  maxFreezesPerYear: 2,
  maxFreezeDaysPerYear: 30,
  discountApprovalThresholdBps: 2000, // >20% discount needs approval
  duplicateCheckinWindowMinutes: 10,
} as const;

/** Shared design tokens consumed by the admin Tailwind theme and the member RN theme. */
export const DESIGN_TOKENS = {
  color: {
    primary: '#16a34a', // adaptable per tenant later
    primaryDark: '#15803d',
    accent: '#f59e0b',
    danger: '#dc2626',
    warning: '#d97706',
    success: '#16a34a',
    info: '#2563eb',
    surface: '#ffffff',
    surfaceMuted: '#f8fafc',
    border: '#e2e8f0',
    text: '#0f172a',
    textMuted: '#64748b',
  },
  radius: { sm: 6, md: 10, lg: 16, full: 9999 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  font: {
    sans: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
    telugu: "'Noto Sans Telugu', system-ui, sans-serif",
  },
  touchTargetMin: 44,
} as const;
