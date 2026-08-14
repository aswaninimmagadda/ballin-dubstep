import 'server-only';
import type { Queryable } from '../db';
import type { SessionUser } from '../session';

/**
 * In-app notification delivery. Writes are idempotent via the dedupe key —
 * a retried transaction can never double-notify. The member app reads these
 * from /api/member/v1/notifications. Push/SMS/WhatsApp channels are Phase 2
 * workers over the same table.
 */
export async function queueMemberNotification(
  tx: Queryable,
  user: SessionUser,
  input: {
    memberId: string;
    event:
      | 'membership_expiring'
      | 'membership_expired'
      | 'renewal_completed'
      | 'payment_received'
      | 'pt_session_upcoming'
      | 'promotion'
      | 'announcement';
    dedupeKey: string;
    body: string;
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO notification_deliveries
       (tenant_id, member_id, event, channel, dedupe_key, rendered_body, status, sent_at)
     VALUES ($1, $2, $3, 'in_app', $4, $5, 'sent', now())
     ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
    [user.tenantId, input.memberId, input.event, input.dedupeKey, input.body],
  );
}
