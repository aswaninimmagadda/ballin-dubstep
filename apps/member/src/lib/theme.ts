import { DESIGN_TOKENS } from '@gymflow/config';

/** Shared design tokens (same source as the admin web theme). */
export const theme = {
  color: DESIGN_TOKENS.color,
  radius: DESIGN_TOKENS.radius,
  spacing: DESIGN_TOKENS.spacing,
  touchTarget: DESIGN_TOKENS.touchTargetMin,
} as const;

export const statusColors: Record<string, { bg: string; fg: string }> = {
  active: { bg: '#dcfce7', fg: '#166534' },
  expiring_soon: { bg: '#fef3c7', fg: '#92400e' },
  grace_period: { bg: '#fef3c7', fg: '#92400e' },
  frozen: { bg: '#dbeafe', fg: '#1e40af' },
  pending: { bg: '#e0e7ff', fg: '#3730a3' },
  expired: { bg: '#fee2e2', fg: '#991b1b' },
  cancelled: { bg: '#f1f5f9', fg: '#475569' },
};
