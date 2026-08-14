import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { asPrincipal } from './db';
import type { SessionUser } from './session';

/**
 * Tenant feature flags, actually enforced. Missing rows default to the
 * platform baseline below, so a tenant provisioned without explicit rows
 * behaves sensibly; an explicit `enabled = false` row always wins.
 */
const DEFAULTS: Record<string, boolean> = {
  attendance: true,
  pt: true,
  leads: true,
  onlinePayments: false,
  merchandise: false,
  classes: false,
  pushNotifications: false,
  whatsappIntegration: false,
};

export const tenantFlags = cache(async (user: SessionUser): Promise<Record<string, boolean>> => {
  if (user.kind === 'platform_admin') return { ...DEFAULTS };
  const rows = await asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(`SELECT key, enabled FROM feature_flags WHERE tenant_id = $1`, [
      user.tenantId,
    ]);
    return r.rows as { key: string; enabled: boolean }[];
  });
  const flags = { ...DEFAULTS };
  for (const row of rows) flags[row.key] = row.enabled;
  return flags;
});

/** Guard a page behind a tenant feature flag. */
export async function requireFeature(user: SessionUser, key: string): Promise<void> {
  const flags = await tenantFlags(user);
  if (!flags[key]) redirect('/');
}
