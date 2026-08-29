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
  // A platform admin who has not entered a gym has no flags to read. Inside
  // one, they see that gym's flags — otherwise the nav would offer them tabs
  // the gym has switched off, and support would be looking at a product the
  // owner does not have.
  if (!user.tenantId) return { ...DEFAULTS };
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
