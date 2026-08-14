import 'server-only';
import type { Queryable } from './db';
import type { SessionUser } from './session';

/**
 * Append an audit record inside the same transaction as the change it
 * describes. `before`/`after` must already be redacted by the caller —
 * never pass credentials or full PII dumps.
 */
export async function writeAudit(
  tx: Queryable,
  user: SessionUser,
  entry: {
    action: string;
    entityType: string;
    entityId?: string | null;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO audit_logs (tenant_id, actor_id, actor_label, action, entity_type, entity_id, before, after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      user.tenantId,
      user.userId,
      user.displayName,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.before ? JSON.stringify(entry.before) : null,
      entry.after ? JSON.stringify(entry.after) : null,
    ],
  );
}
