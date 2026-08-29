import 'server-only';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { createHash, randomBytes } from 'node:crypto';
import { redirect } from 'next/navigation';
import { verifyPassword, verifyPasswordDecoy, hasPermission } from '@gymflow/core';
import type { Permission } from '@gymflow/types';
import { asAnonymous, asPrincipal, type Claims } from './db';
import { clientIpFromHeaders } from './client-ip';

export const SESSION_COOKIE = 'gymflow_session';
/**
 * The gym a platform admin has entered. A platform admin's own tenant_id is
 * NULL — that is what makes them cross-tenant — so without this they landed on
 * the operational screens with every gym's rows merged into one list and no
 * column saying whose was whose. The cookie carries the choice; migration 0022
 * makes RLS honour it, so entering a gym is a database boundary and not a
 * filter a page could forget to apply.
 */
export const PLATFORM_SCOPE_COOKIE = 'gymflow_scope';
const SESSION_HOURS = 12;
const MAX_FAILED_ATTEMPTS = 8;
/**
 * Per-address ceiling. A whole gym shares one public IP, so this must be far
 * above the per-identifier limit: it is there to blunt bulk guessing, not to
 * let one member's forgotten password lock the front desk out.
 */
const MAX_FAILED_PER_IP = 60;
const THROTTLE_WINDOW = '15 minutes';

/**
 * True when this login should be refused without checking the password —
 * either too many failures for this identifier, or an implausible number
 * from this address.
 */
export async function isThrottled(identifier: string, ip: string | null): Promise<boolean> {
  const counts = await asAnonymous(async (tx) => {
    const r = await tx.query(
      `SELECT by_identifier, by_ip FROM app.login_attempt_counts($1, $2, $3::interval)`,
      [identifier, ip, THROTTLE_WINDOW],
    );
    return (r as { rows: { by_identifier: string; by_ip: string }[] }).rows[0];
  });
  return (
    Number(counts?.by_identifier ?? 0) >= MAX_FAILED_ATTEMPTS ||
    Number(counts?.by_ip ?? 0) >= MAX_FAILED_PER_IP
  );
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SessionUser {
  userId: string;
  tenantId: string | null;
  kind: 'platform_admin' | 'staff' | 'member';
  displayName: string;
  language: 'en' | 'te';
  permissions: Set<string>;
  claims: Claims;
  /**
   * They are still on the password that was generated for them and read out
   * across the counter. The layout sends them to change it before anything
   * else, so a spoken credential does not become a permanent one.
   */
  mustChangePassword: boolean;
}

export type LoginResult =
  { ok: true } | { ok: false; reason: 'invalid' | 'locked' | 'inactive' | 'tenant_suspended' };

export async function loginStaff(email: string, password: string): Promise<LoginResult> {
  const ip = await clientIp();
  if (await isThrottled(email, ip)) return { ok: false, reason: 'locked' };

  const row = await asAnonymous(async (tx) => {
    const r = await tx.query(`SELECT * FROM app.auth_staff_lookup($1)`, [email]);
    return (r as { rows: Record<string, unknown>[] }).rows[0];
  });

  const recordAttempt = (ok: boolean) =>
    asAnonymous((tx) => tx.query(`SELECT app.record_login_attempt($1, $2, $3)`, [email, ip, ok]));

  // Always pay the scrypt cost, even when the account does not exist —
  // otherwise the response time answers "is this an account?" in one request.
  const passwordOk = row
    ? await verifyPassword(password, row.password_hash as string)
    : await verifyPasswordDecoy(password);
  if (!row || !passwordOk) {
    await recordAttempt(false);
    return { ok: false, reason: 'invalid' };
  }
  if (!row.is_active) {
    await recordAttempt(false);
    return { ok: false, reason: 'inactive' };
  }
  if (
    row.kind === 'staff' &&
    row.tenant_status &&
    row.tenant_status !== 'active' &&
    row.tenant_status !== 'trial'
  ) {
    await recordAttempt(false);
    return { ok: false, reason: 'tenant_suspended' };
  }
  await recordAttempt(true);

  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_HOURS * 3600_000);
  const ua = (await headers()).get('user-agent') ?? '';
  await asAnonymous((tx) =>
    tx.query(`SELECT app.session_create($1, $2, $3, $4, $5)`, [
      row.user_id,
      sha256(token),
      expires.toISOString(),
      ip,
      ua,
    ]),
  );
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires,
  });
  return { ok: true };
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await asAnonymous((tx) => tx.query(`SELECT app.session_revoke($1)`, [sha256(token)]));
  }
  jar.delete(SESSION_COOKIE);
  jar.delete(PLATFORM_SCOPE_COOKIE);
}

/** Resolve the current session (memoized per request). Null when signed out. */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = await asAnonymous(async (tx) => {
    const r = await tx.query(`SELECT * FROM app.session_lookup($1)`, [sha256(token)]);
    return (r as { rows: Record<string, unknown>[] }).rows[0];
  });
  if (!row || !row.is_active) return null;
  if (
    row.kind === 'staff' &&
    row.tenant_status &&
    !['active', 'trial'].includes(row.tenant_status as string)
  ) {
    return null;
  }
  // Only a platform admin can be scoped, and only into a gym: staff already
  // carry their own tenant and the cookie is ignored for them, so a forged
  // value buys nothing.
  const scope =
    row.kind === 'platform_admin' ? (jar.get(PLATFORM_SCOPE_COOKIE)?.value ?? null) : null;
  const scopedTenant = scope && UUID_RE.test(scope) ? scope : null;
  const claims: Claims = {
    sub: row.user_id as string,
    tenant_id: ((row.tenant_id as string | null) ?? null) || scopedTenant,
    kind: row.kind as Claims['kind'],
  };
  const permissions = await loadPermissions(claims);
  return {
    userId: row.user_id as string,
    tenantId: claims.tenant_id,
    kind: claims.kind,
    displayName: row.display_name as string,
    language: (row.language as 'en' | 'te') ?? 'en',
    permissions,
    claims,
    mustChangePassword: row.must_change === true,
  };
});

async function loadPermissions(claims: Claims): Promise<Set<string>> {
  if (claims.kind === 'platform_admin') return new Set(['platform.admin']);
  const rows = await asPrincipal(claims, async (tx) => {
    const r = await tx.query(
      `SELECT DISTINCT rp.permission
       FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
       WHERE ur.user_id = $1`,
      [claims.sub],
    );
    return (r as { rows: { permission: string }[] }).rows;
  });
  return new Set(rows.map((r) => r.permission));
}

/** Require a signed-in staff/platform user or redirect to login. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user || user.kind === 'member') redirect('/login');
  return user;
}

/** Require a specific permission or render the 403 page. */
export async function requirePermission(perm: Permission): Promise<SessionUser> {
  const user = await requireUser();
  // A one-time desk password can do exactly one thing: replace itself.
  //
  // user_credentials.must_change has existed since the first migration and
  // nothing read it, so every password generated at the desk — spoken aloud,
  // sometimes written down, always seen by whoever issued it — stayed valid
  // indefinitely. The gate lives here rather than in the layout because the
  // change-password page is inside the same route group and a layout redirect
  // would loop; that page needs no permission, so it stays reachable.
  if (user.mustChangePassword) redirect('/account/password?msg=must_change');
  // A platform admin can do anything — inside one gym at a time. Unscoped they
  // belong on the console, not on a members list that would silently be every
  // gym's members at once.
  if (user.kind === 'platform_admin') {
    if (!user.tenantId) redirect('/platform');
    return user;
  }
  if (!hasPermission(user.permissions, perm)) redirect('/forbidden');
  return user;
}

export async function clientIp(): Promise<string | null> {
  return clientIpFromHeaders(await headers());
}
