import type { UUID, ISODateTime, CurrencyCode, LanguageTag } from './ids';

export type TenantStatus = 'trial' | 'active' | 'suspended' | 'archived';

export interface Tenant {
  id: UUID;
  slug: string;
  name: string;
  status: TenantStatus;
  subscriptionTier: 'starter' | 'standard' | 'premium';
  trialEndsAt: ISODateTime | null;
  defaultCurrency: CurrencyCode;
  defaultTimezone: string;
  defaultLanguage: LanguageTag;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Brand {
  id: UUID;
  tenantId: UUID;
  name: string;
  logoPath: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  supportPhone: string | null;
  supportWhatsapp: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Branch {
  id: UUID;
  tenantId: UUID;
  brandId: UUID;
  name: string;
  code: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  pinCode: string | null;
  phone: string | null;
  timezone: string;
  isActive: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}
