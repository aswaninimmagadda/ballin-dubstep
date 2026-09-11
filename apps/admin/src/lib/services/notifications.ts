import 'server-only';
import { getTranslations, renderTemplate, type Language } from '@gymflow/i18n';
import { formatDisplayDate } from '@gymflow/utils';
import type { Queryable } from '../db';

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

/**
 * Which gym this member belongs to, and which language to write to them in.
 *
 * The gym comes from the MEMBER, not from whoever is signed in. Today those
 * are always the same value — requirePermission sends an unscoped platform
 * admin to /platform, so every caller reaches here with a tenant, and RLS
 * means the member they just acted on is in it. This is defence, not a
 * repair: the session's tenant being right depends on an invariant three
 * layers away, and a caller that does not go through requirePermission — a
 * cron job, a webhook handler, a synthetic user — would have written the
 * gym's notification under whatever tenant it happened to carry. The
 * member's own row cannot be wrong about whose member they are.
 *
 * It also gives the one honest answer when the member is not visible at
 * all: return nothing, rather than write a row under the session's tenant
 * for a member the session cannot see.
 */
async function memberContext(
  tx: Queryable,
  memberId: string,
): Promise<{ tenantId: string; language: Language } | null> {
  // On the tenant fallback, and what it is and is not worth:
  // users.language is NOT NULL DEFAULT 'en', so once a member has an app
  // login u.language is always set and the coalesce never reaches
  // tenants.default_language. The fallback governs the other case — a
  // member with no login yet — and those rows are NOT thrown away: the
  // notifications endpoint selects by member_id with no created_at floor,
  // so everything queued before the desk switched the app on appears in
  // the member's list the day it is. A gym that had set default_language
  // would therefore see its back-history in one language and everything
  // after the member's first sign-in in whatever they chose.
  //
  // Today that cannot happen, because nothing writes default_language:
  // there is no Settings field and the provisioning CLI does not set it,
  // so it is 'en' everywhere. Making a gym-level default real needs the
  // column to be nullable, so "never chose" is representable, plus
  // somewhere to set it — a missing feature recorded in KNOWN_LIMITATIONS,
  // not something this query can fix. The member's own choice, which the
  // app now sends at sign-in, is the path that works.
  const r = await tx.query(
    `SELECT m.tenant_id, coalesce(u.language, t.default_language) AS language
       FROM members m
       JOIN tenants t ON t.id = m.tenant_id
       LEFT JOIN users u ON u.id = m.user_id
      WHERE m.id = $1`,
    [memberId],
  );
  const row = (r as { rows: { tenant_id: string; language: string | null }[] }).rows[0];
  if (!row) return null;
  return { tenantId: row.tenant_id, language: row.language === 'te' ? 'te' : 'en' };
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
  const ctx = await memberContext(tx, input.memberId);
  // No row means RLS did not hand this member over. Nothing to notify, and
  // nothing to guess a tenant from — write nothing rather than a row in the
  // wrong gym.
  if (!ctx) return;
  const { tenantId, language } = ctx;
  const tr = getTranslations(language);
  const body = tr.member.notifications[input.template];
  const custom = await tenantTemplate(tx, tenantId, input.event, language);

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
    [tenantId, input.memberId, input.event, input.dedupeKey, renderTemplate(custom ?? body, vars)],
  );
}
