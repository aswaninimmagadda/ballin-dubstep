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
  gstin: string | null;
  tax_sac_code: string;
  tax_state_name: string | null;
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

/**
 * Columns settings.manage may write, and whether clearing them is meaningful.
 * Anything not listed here cannot be reached from the form at all.
 */
const SETTINGS_COLUMNS = {
  receipt_prefix: 'value',
  default_grace_period_days: 'value',
  max_freezes_per_year: 'value',
  max_freeze_days_per_year: 'value',
  allow_partial_payments: 'value',
  whatsapp_renewal_template_en: 'value',
  whatsapp_renewal_template_te: 'value',
  receipt_footer: 'clearable',
  date_format: 'value',
  gstin: 'clearable',
  tax_sac_code: 'value',
  tax_state_name: 'clearable',
} as const;

export type SettingsPatch = Partial<
  Record<keyof typeof SETTINGS_COLUMNS, string | number | boolean | null>
>;

/**
 * Absent key = leave the column alone. Explicit null = clear it.
 *
 * The previous version built one fixed UPDATE of `coalesce($n, column)`, which
 * made those two cases indistinguishable: a grace period of 0, a max-freezes
 * of 0, or a cleared receipt footer all arrived as null and were silently
 * discarded — while the page still said "Settings saved." Building the SET
 * list from what the caller actually sent is what makes a zero a zero.
 */
export async function updateSettings(user: SessionUser, patch: SettingsPatch): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [user.tenantId];
  for (const [col, mode] of Object.entries(SETTINGS_COLUMNS)) {
    const value = patch[col as keyof typeof SETTINGS_COLUMNS];
    if (value === undefined) continue;
    if (value === null && mode !== 'clearable') continue;
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  }
  if (!sets.length) return;
  return asPrincipal(user.claims, async (tx) => {
    const before = await tx.query(`SELECT * FROM gym_settings WHERE tenant_id = $1`, [
      user.tenantId,
    ]);
    await tx.query(`UPDATE gym_settings SET ${sets.join(', ')} WHERE tenant_id = $1`, params);
    const prev = (before.rows[0] ?? {}) as Record<string, unknown>;
    await writeAudit(tx, user, {
      action: 'settings.update',
      entityType: 'gym_settings',
      entityId: user.tenantId,
      before: Object.fromEntries(Object.keys(patch).map((k) => [k, prev[k] ?? null])),
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

export interface BrandRow {
  id: string;
  name: string;
  primary_color: string | null;
  support_phone: string | null;
  support_whatsapp: string | null;
  terms_url: string | null;
  privacy_url: string | null;
}

export async function getBrand(user: SessionUser): Promise<BrandRow | null> {
  return asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(
      `SELECT id, name, primary_color, support_phone, support_whatsapp, terms_url, privacy_url
       FROM brands WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`,
      [user.tenantId],
    );
    return (r.rows[0] as BrandRow) ?? null;
  });
}

export async function updateBrand(
  user: SessionUser,
  patch: Partial<Omit<BrandRow, 'id'>>,
): Promise<void> {
  return asPrincipal(user.claims, async (tx) => {
    await tx.query(
      `UPDATE brands SET
         name = coalesce($2, name),
         primary_color = coalesce($3, primary_color),
         support_phone = coalesce($4, support_phone),
         support_whatsapp = coalesce($5, support_whatsapp),
         terms_url = coalesce($6, terms_url),
         privacy_url = coalesce($7, privacy_url)
       WHERE tenant_id = $1`,
      [
        user.tenantId,
        patch.name ?? null,
        patch.primary_color ?? null,
        patch.support_phone ?? null,
        patch.support_whatsapp ?? null,
        patch.terms_url ?? null,
        patch.privacy_url ?? null,
      ],
    );
    await writeAudit(tx, user, {
      action: 'brand.update',
      entityType: 'brand',
      after: patch as Record<string, unknown>,
    });
  });
}
