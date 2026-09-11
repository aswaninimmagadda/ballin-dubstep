import 'server-only';
import { getTranslations, renderTemplate, type Language } from '@gymflow/i18n';
import { formatDisplayDate } from '@gymflow/utils';
import type { Queryable } from '../db';
import type { SessionUser } from '../session';

/**
 * In-app notification delivery. Writes are idempotent via the dedupe key —
 * a retried transaction can never double-notify. The member app reads these
 * from /api/member/v1/notifications. Push/SMS/WhatsApp channels are Phase 2
 * workers over the same table.
 *
 * The body is rendered here, at the moment the thing happens, because that
 * is when the facts are known — and it is rendered in THE MEMBER'S OWN
 * LANGUAGE. It used to be an English string literal at each call site, so a
 * member who had set the app to Telugu still got "Payment received. Receipt
 * SVF/2026-27/00042." and, on renewal, a pair of raw ISO dates.
 */

export type NotificationEvent =
  | 'membership_expiring'
  | 'membership_expired'
  | 'renewal_completed'
  | 'payment_received'
  | 'pt_session_upcoming'
  | 'promotion'
  | 'announcement';

/** The member's chosen language, or the gym's default, or English. */
async function memberLanguage(tx: Queryable, memberId: string): Promise<Language> {
  const r = await tx.query(
    `SELECT coalesce(u.language, t.default_language) AS language
       FROM members m
       JOIN tenants t ON t.id = m.tenant_id
       LEFT JOIN users u ON u.id = m.user_id
      WHERE m.id = $1`,
    [memberId],
  );
  const value = (r as { rows: { language: string | null }[] }).rows[0]?.language;
  return value === 'te' ? 'te' : 'en';
}

/**
 * A gym's own wording for this event, if it has set one. Tries the member's
 * language first and English second: a gym that has written only an English
 * template should not silently lose it for Telugu-speaking members.
 */
async function tenantTemplate(
  tx: Queryable,
  tenantId: string,
  event: NotificationEvent,
  language: Language,
): Promise<string | null> {
  const r = await tx.query(
    `SELECT body, language FROM notification_templates
      WHERE tenant_id = $1 AND event = $2 AND channel = 'in_app' AND is_active
        AND language IN ($3, 'en')
      ORDER BY (language = $3) DESC
      LIMIT 1`,
    [tenantId, event, language],
  );
  return (r as { rows: { body: string }[] }).rows[0]?.body ?? null;
}

export async function queueMemberNotification(
  tx: Queryable,
  user: SessionUser,
  input: {
    memberId: string;
    event: NotificationEvent;
    dedupeKey: string;
    /**
     * Which built-in wording to use when the gym has not written its own.
     * A key under `member.notifications` in packages/i18n.
     */
    template: 'payment_received' | 'payment_received_for' | 'renewal_completed';
    /**
     * Values for the {{placeholders}}. Dates must be ISO here — they are
     * formatted for the member's language on the way in.
     */
    vars?: Record<string, string>;
    /** Keys in `vars` holding an ISO date, to be formatted before rendering. */
    dateVars?: string[];
  },
): Promise<void> {
  const language = await memberLanguage(tx, input.memberId);
  const tr = getTranslations(language);
  const body = tr.member.notifications[input.template];
  const custom = await tenantTemplate(tx, user.tenantId as string, input.event, language);

  const vars: Record<string, string> = { ...(input.vars ?? {}) };
  for (const key of input.dateVars ?? []) {
    const iso = vars[key];
    if (iso) vars[key] = formatDisplayDate(iso, 'DD-Mon-YYYY', tr.member.monthsShort);
  }

  await tx.query(
    `INSERT INTO notification_deliveries
       (tenant_id, member_id, event, channel, dedupe_key, rendered_body, status, sent_at)
     VALUES ($1, $2, $3, 'in_app', $4, $5, 'sent', now())
     ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
    [
      user.tenantId,
      input.memberId,
      input.event,
      input.dedupeKey,
      renderTemplate(custom ?? body, vars),
    ],
  );
}
