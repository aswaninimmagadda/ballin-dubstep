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

/**
 * Shared design tokens consumed by the admin Tailwind theme and the member RN theme.
 *
 * Every colour here that can carry white text does so somewhere, so every one
 * of them must clear WCAG AA for normal text — 4.5:1 — against #ffffff. The
 * ratios below are measured, not estimated, and
 * packages/utils/test/palette.test.ts fails the build if any of them slips.
 *
 * They were not measured before. The brand green was #16a34a at 3.30:1, which
 * is under the floor for body text and buttons: legible on a designer's
 * laptop, marginal on the cheap monitor at a gym counter in daylight, and a
 * straight accessibility-audit failure for anyone selling this to an
 * institution. Greens, ambers and the rest have moved one Tailwind step
 * darker — the same hues, now readable.
 */
export const DESIGN_TOKENS = {
  color: {
    primary: '#15803d', // green-700  — 5.02:1 on white (was #16a34a, 3.30:1)
    primaryDark: '#166534', // green-800  — 7.13:1, the hover/active step
    accent: '#b45309', // amber-700  — 5.02:1 (was #f59e0b, 2.15:1)
    danger: '#dc2626', // red-600    — 4.83:1
    warning: '#92400e', // amber-800  — 7.09:1 (was #d97706, 3.19:1)
    success: '#15803d', // green-700  — 5.02:1
    info: '#2563eb', // blue-600   — 5.17:1
    surface: '#ffffff',
    surfaceMuted: '#f8fafc',
    border: '#e2e8f0',
    text: '#0f172a',
    // Body-size muted text. slate-500 (#64748b) is 4.55:1 on the muted
    // surface — over the line but with no margin for a dimmed phone screen.
    textMuted: '#475569', // slate-600  — 7.24:1 on the muted surface
  },
  radius: { sm: 6, md: 10, lg: 16, full: 9999 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  font: {
    sans: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
    telugu: "'Noto Sans Telugu', system-ui, sans-serif",
  },
  touchTargetMin: 44,
} as const;
