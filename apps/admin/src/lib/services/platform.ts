import 'server-only';
import { asPrincipal } from '../db';
import { writeAudit } from '../audit';
import type { SessionUser } from '../session';
import { UserFacingError } from '../errors';

export interface PlatformTenant {
  id: string;
  slug: string;
  name: string;
  status: string;
  subscription_tier: string;
  trial_ends_at: string | null;
  created_at: string;
  branches: number;
  staff: number;
  members: number;
  active_memberships: number;
  last_activity: string | null;
}

function requirePlatform(user: SessionUser): void {
  if (user.kind !== 'platform_admin') throw new UserFacingError('Platform access only.');
}

/**
 * Every gym on the platform, one row each. This is the only screen that is
 * meant to be cross-tenant — the operational screens are scoped to whichever
 * gym the admin has entered, which is why they can no longer be reached
 * without picking one.
 */
export async function listTenants(user: SessionUser): Promise<PlatformTenant[]> {
  requirePlatform(user);
  if (user.tenantId) throw new UserFacingError('Leave the gym you are in first.');
  return asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(
      `SELECT t.id, t.slug, t.name, t.status, t.subscription_tier,
              t.trial_ends_at::text AS trial_ends_at, t.created_at::text AS created_at,
              (SELECT count(*) FROM branches b WHERE b.tenant_id = t.id)::int AS branches,
              (SELECT count(*) FROM users u
                WHERE u.tenant_id = t.id AND u.kind = 'staff' AND u.is_active)::int AS staff,
              (SELECT count(*) FROM members m WHERE m.tenant_id = t.id)::int AS members,
              (SELECT count(*) FROM memberships ms
                WHERE ms.tenant_id = t.id AND ms.state IN ('active','frozen'))::int
                AS active_memberships,
              (SELECT max(p.created_at)::text FROM payments p WHERE p.tenant_id = t.id)
                AS last_activity
         FROM tenants t
        ORDER BY (t.status = 'active') DESC, t.name`,
    );
    return r.rows as PlatformTenant[];
  });
}

/** The gym the admin is currently inside, for the banner. */
export async function scopedTenant(
  user: SessionUser,
): Promise<{ id: string; name: string; slug: string; status: string } | null> {
  if (user.kind !== 'platform_admin' || !user.tenantId) return null;
  return asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(`SELECT id, name, slug, status FROM tenants WHERE id = $1`, [
      user.tenantId,
    ]);
    return (r.rows[0] as { id: string; name: string; slug: string; status: string }) ?? null;
  });
}

/**
 * Confirm the gym exists before we hand the admin a scope cookie for it, and
 * record that they went in. Support opening a gym's books is a thing the gym
 * is entitled to see in its own audit log.
 */
export async function enterTenant(user: SessionUser, tenantId: string): Promise<void> {
  requirePlatform(user);
  const exists = await asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(`SELECT id FROM tenants WHERE id = $1`, [tenantId]);
    return r.rows.length > 0;
  });
  if (!exists) throw new UserFacingError('No such gym.');
  await asPrincipal(user.claims, (tx) =>
    writeAudit(
      tx,
      { ...user, tenantId },
      {
        action: 'platform.enter_tenant',
        entityType: 'tenant',
        entityId: tenantId,
      },
    ),
  );
}
