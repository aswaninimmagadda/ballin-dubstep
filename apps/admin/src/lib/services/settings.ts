import 'server-only';
import { renderTemplate } from '@gymflow/i18n';
import { formatDisplayDate, whatsappLink } from '@gymflow/utils';
import { asPrincipal } from '../db';
import { writeAudit } from '../audit';
import type { SessionUser } from '../session';

export interface TenantSettings {
  tenant_name: string;
  receipt_prefix: string;
  membership_number_prefix: string;
  expiry_reminder_days: number[];
  default_grace_period_days: number;
  max_freezes_per_year: number;
  max_freeze_days_per_year: number;
  allow_partial_payments: boolean;
  discount_approval_threshold_bps: number;
  whatsapp_renewal_template_en: string;
  whatsapp_renewal_template_te: string;
  receipt_footer: string | null;
  date_format: string;
}

export async function getSettings(user: SessionUser): Promise<TenantSettings | null> {
  return asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(
      `SELECT t.name AS tenant_name, gs.*
       FROM gym_settings gs JOIN tenants t ON t.id = gs.tenant_id
       WHERE gs.tenant_id = $1`,
      [user.tenantId],
    );
    return (r.rows[0] as TenantSettings) ?? null;
  });
}

export async function updateSettings(
  user: SessionUser,
  patch: Partial<
    Pick<
      TenantSettings,
      | 'receipt_prefix'
      | 'default_grace_period_days'
      | 'max_freezes_per_year'
      | 'max_freeze_days_per_year'
      | 'allow_partial_payments'
      | 'whatsapp_renewal_template_en'
      | 'whatsapp_renewal_template_te'
      | 'receipt_footer'
      | 'date_format'
    >
  >,
): Promise<void> {
  return asPrincipal(user.claims, async (tx) => {
    const before = await tx.query(`SELECT * FROM gym_settings WHERE tenant_id = $1`, [
      user.tenantId,
    ]);
    await tx.query(
      `UPDATE gym_settings SET
         receipt_prefix = coalesce($2, receipt_prefix),
         default_grace_period_days = coalesce($3, default_grace_period_days),
         max_freezes_per_year = coalesce($4, max_freezes_per_year),
         max_freeze_days_per_year = coalesce($5, max_freeze_days_per_year),
         allow_partial_payments = coalesce($6, allow_partial_payments),
         whatsapp_renewal_template_en = coalesce($7, whatsapp_renewal_template_en),
         whatsapp_renewal_template_te = coalesce($8, whatsapp_renewal_template_te),
         receipt_footer = coalesce($9, receipt_footer),
         date_format = coalesce($10, date_format)
       WHERE tenant_id = $1`,
      [
        user.tenantId,
        patch.receipt_prefix ?? null,
        patch.default_grace_period_days ?? null,
        patch.max_freezes_per_year ?? null,
        patch.max_freeze_days_per_year ?? null,
        patch.allow_partial_payments ?? null,
        patch.whatsapp_renewal_template_en ?? null,
        patch.whatsapp_renewal_template_te ?? null,
        patch.receipt_footer ?? null,
        patch.date_format ?? null,
      ],
    );
    await writeAudit(tx, user, {
      action: 'settings.update',
      entityType: 'gym_settings',
      entityId: user.tenantId,
      before: { receipt_prefix: (before.rows[0] as Record<string, unknown>)?.receipt_prefix },
      after: patch as Record<string, unknown>,
    });
  });
}

/** Build the WhatsApp renewal deep link for a member, using tenant templates. */
export async function renewalWhatsappLink(
  user: SessionUser,
  opts: { memberId: string; language?: 'en' | 'te' },
): Promise<string | null> {
  return asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(
      `SELECT m.first_name, m.mobile, t.name AS gym_name, gs.date_format,
              gs.whatsapp_renewal_template_en, gs.whatsapp_renewal_template_te,
              ms.end_date::text AS end_date
       FROM members m
       JOIN tenants t ON t.id = m.tenant_id
       JOIN gym_settings gs ON gs.tenant_id = m.tenant_id
       LEFT JOIN LATERAL (
         SELECT end_date FROM memberships WHERE member_id = m.id
         ORDER BY end_date DESC LIMIT 1
       ) ms ON true
       WHERE m.id = $1`,
      [opts.memberId],
    );
    const row = r.rows[0] as Record<string, string> | undefined;
    if (!row) return null;
    const template =
      (opts.language ?? 'en') === 'te'
        ? row.whatsapp_renewal_template_te!
        : row.whatsapp_renewal_template_en!;
    const message = renderTemplate(template, {
      member_first_name: row.first_name!,
      gym_name: row.gym_name!,
      expiry_date: row.end_date ? formatDisplayDate(row.end_date, 'DD-Mon-YYYY') : '-',
    });
    return whatsappLink(row.mobile!, message);
  });
}
