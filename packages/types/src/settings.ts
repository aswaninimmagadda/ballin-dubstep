import type { UUID, ISODateTime } from './ids.js';

/**
 * Tenant settings are structured (one row per tenant) rather than a free-form
 * JSON blob, except `extra` for genuinely dynamic keys.
 */
export interface GymSettings {
  tenantId: UUID;
  receiptPrefix: string; // e.g. "GYM"
  receiptSequencePadding: number; // e.g. 6 -> 000123
  membershipNumberPrefix: string;
  membershipNumberNext: number;
  expiryReminderDays: number[]; // e.g. [7, 3, 1]
  defaultGracePeriodDays: number;
  maxFreezesPerYear: number;
  maxFreezeDaysPerYear: number;
  allowPartialPayments: boolean;
  discountApprovalThresholdBps: number; // discounts above this need approval
  whatsappRenewalTemplateEn: string;
  whatsappRenewalTemplateTe: string;
  receiptFooter: string | null;
  dateFormat: string; // display format, e.g. "DD-MM-YYYY"
  extra: Record<string, unknown>;
  updatedAt: ISODateTime;
}

export type FeatureFlagKey =
  | 'attendance'
  | 'pt'
  | 'leads'
  | 'onlinePayments'
  | 'merchandise'
  | 'classes'
  | 'pushNotifications'
  | 'whatsappIntegration';

export interface FeatureFlag {
  tenantId: UUID;
  key: FeatureFlagKey;
  enabled: boolean;
  updatedAt: ISODateTime;
}
