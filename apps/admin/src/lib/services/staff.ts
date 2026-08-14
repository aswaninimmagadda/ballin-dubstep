import 'server-only';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '@gymflow/core';
import { asPrincipal } from '../db';
import { writeAudit } from '../audit';
import { UserFacingError } from '../errors';
import type { SessionUser } from '../session';

export interface StaffRow {
  id: string;
  email: string;
  display_name: string;
  is_active: boolean;
  role_name: string | null;
  role_key: string | null;
  last_login_at: string | null;
}

export async function listStaff(user: SessionUser): Promise<StaffRow[]> {
  return asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(
      `SELECT u.id, u.email, u.display_name, u.is_active,
              u.last_login_at::text AS last_login_at, r.name AS role_name, r.key AS role_key
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id AND r.key <> 'member'
       WHERE u.kind = 'staff'
       ORDER BY u.created_at`,
    );
    return r.rows as StaffRow[];
  });
}

export async function listAssignableRoles(
  user: SessionUser,
): Promise<{ id: string; key: string; name: string }[]> {
  return asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(
      `SELECT id, key, name FROM roles
       WHERE tenant_id = $1 AND key <> 'member' ORDER BY name`,
      [user.tenantId],
    );
    return r.rows as never;
  });
}

/**
 * Create a staff account with a role. Returns a one-time initial password
 * (shown to the owner exactly once, never stored in plaintext).
 */
export async function createStaff(
  user: SessionUser,
  input: { email: string; displayName: string; roleId: string },
): Promise<{ userId: string; initialPassword: string }> {
  const initialPassword = randomBytes(9).toString('base64url'); // 12 chars
  const hash = await hashPassword(initialPassword);
  return asPrincipal(user.claims, async (tx) => {
    const roleCheck = await tx.query(
      `SELECT id FROM roles WHERE id = $1 AND tenant_id = $2 AND key <> 'member'`,
      [input.roleId, user.tenantId],
    );
    if (!roleCheck.rows[0]) throw new UserFacingError('Choose a valid role.');
    let userId: string;
    try {
      const u = await tx.query(
        `INSERT INTO users (kind, tenant_id, email, display_name)
         VALUES ('staff', $1, lower($2), $3) RETURNING id`,
        [user.tenantId, input.email, input.displayName],
      );
      userId = (u.rows[0] as { id: string }).id;
    } catch (err) {
      if (/users_email_unique/.test((err as Error).message)) {
        throw new UserFacingError('A staff account with this email already exists.');
      }
      throw err;
    }
    await tx.query(`INSERT INTO user_roles (user_id, role_id, granted_by) VALUES ($1, $2, $3)`, [
      userId,
      input.roleId,
      user.userId,
    ]);
    await tx.query(`SELECT app.staff_set_initial_password($1, $2)`, [userId, hash]);
    await writeAudit(tx, user, {
      action: 'staff.create',
      entityType: 'user',
      entityId: userId,
      after: { email: input.email.toLowerCase(), roleId: input.roleId },
    });
    return { userId, initialPassword };
  });
}

export async function setStaffActive(
  user: SessionUser,
  staffUserId: string,
  active: boolean,
): Promise<void> {
  if (staffUserId === user.userId) {
    throw new UserFacingError('You cannot deactivate your own account.');
  }
  return asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(`UPDATE users SET is_active = $2 WHERE id = $1 AND kind = 'staff'`, [
      staffUserId,
      active,
    ]);
    if (r.rowCount === 0) throw new UserFacingError('Staff account not found.');
    if (!active) {
      await tx.query(`SELECT app.sessions_revoke_all($1)`, [staffUserId]);
    }
    await writeAudit(tx, user, {
      action: active ? 'staff.activate' : 'staff.deactivate',
      entityType: 'user',
      entityId: staffUserId,
    });
  });
}

/** Reset a staff password; returns the new one-time password. */
export async function resetStaffPassword(user: SessionUser, staffUserId: string): Promise<string> {
  const newPassword = randomBytes(9).toString('base64url');
  const hash = await hashPassword(newPassword);
  await asPrincipal(user.claims, async (tx) => {
    const exists = await tx.query(`SELECT 1 FROM users WHERE id = $1 AND kind = 'staff'`, [
      staffUserId,
    ]);
    if (!exists.rows[0]) throw new UserFacingError('Staff account not found.');
    await tx.query(`SELECT app.staff_set_initial_password($1, $2)`, [staffUserId, hash]);
    await tx.query(`SELECT app.sessions_revoke_all($1)`, [staffUserId]);
    await writeAudit(tx, user, {
      action: 'staff.reset_password',
      entityType: 'user',
      entityId: staffUserId,
    });
  });
  return newPassword;
}
