import 'server-only';
import { hashPassword, verifyPassword } from '@gymflow/core';
import { asPrincipal } from '../db';
import { writeAudit } from '../audit';
import { UserFacingError } from '../errors';
import type { SessionUser } from '../session';

/**
 * Change your own password. Requires the current one, so a borrowed session
 * on an unlocked desk machine cannot lock the real owner out of their gym.
 * Every other session for the account is revoked afterwards.
 */
export async function changeOwnPassword(
  user: SessionUser,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  if (newPassword.length < 10) {
    throw new UserFacingError('Choose a new password of at least 10 characters.');
  }
  if (newPassword === currentPassword) {
    throw new UserFacingError('The new password must be different from the current one.');
  }
  const hash = await asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(`SELECT app.auth_self_credential() AS hash`);
    return (r.rows[0] as { hash: string | null } | undefined)?.hash ?? null;
  });
  if (!hash || !(await verifyPassword(currentPassword, hash))) {
    throw new UserFacingError('Your current password is not correct.');
  }
  const nextHash = await hashPassword(newPassword);
  await asPrincipal(user.claims, async (tx) => {
    await tx.query(`SELECT app.auth_set_password($1, $2)`, [user.userId, nextHash]);
    // Signing everyone out is the point: a rotated password must invalidate
    // whatever the old one could still reach, including this browser.
    await tx.query(`SELECT app.sessions_revoke_all($1)`, [user.userId]);
    await writeAudit(tx, user, {
      action: 'account.password_change',
      entityType: 'user',
      entityId: user.userId,
    });
  });
}
