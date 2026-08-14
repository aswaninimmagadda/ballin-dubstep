import type { UUID, ISODateTime, LanguageTag } from './ids';

export type NotificationChannel = 'in_app' | 'push' | 'whatsapp_link' | 'sms' | 'email';

export type NotificationEvent =
  | 'membership_expiring'
  | 'membership_expired'
  | 'renewal_completed'
  | 'payment_received'
  | 'pt_session_upcoming'
  | 'promotion'
  | 'announcement';

export interface NotificationTemplate {
  id: UUID;
  tenantId: UUID;
  event: NotificationEvent;
  channel: NotificationChannel;
  language: LanguageTag;
  /** Handlebars-style body: Hi {{member_first_name}}, ... */
  body: string;
  isActive: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface NotificationDelivery {
  id: UUID;
  tenantId: UUID;
  memberId: UUID | null;
  event: NotificationEvent;
  channel: NotificationChannel;
  /** Dedupe key prevents double sends for the same event instance. */
  dedupeKey: string;
  renderedBody: string;
  status: 'queued' | 'sent' | 'failed' | 'skipped';
  error: string | null;
  createdAt: ISODateTime;
  sentAt: ISODateTime | null;
}
