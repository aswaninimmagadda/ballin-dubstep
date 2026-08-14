import 'server-only';
import { headers } from 'next/headers';
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
  let ip: string | null = null;
  let userAgent: string | null = null;
  try {
    const h = await headers();
    ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null;
    userAgent = h.get('user-agent')?.slice(0, 300) ?? null;
  } catch {
    // outside a request context (scripts/jobs) — leave null
  }
  await tx.query(
    `INSERT INTO audit_logs (tenant_id, actor_id, actor_label, action, entity_type, entity_id, before, after, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      user.tenantId,
      user.userId,
      user.displayName,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.before ? JSON.stringify(entry.before) : null,
      entry.after ? JSON.stringify(entry.after) : null,
      ip,
      userAgent,
    ],
  );
}
