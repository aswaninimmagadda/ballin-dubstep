import { NextResponse, type NextRequest } from 'next/server';
import { asPrincipal } from '@/lib/db';
import { isErrorResponse, memberAuth, withApiLogging } from '@/lib/member-api';

export const dynamic = 'force-dynamic';

async function handleGet(req: NextRequest): Promise<NextResponse> {
  const auth = memberAuth(req);
  if (isErrorResponse(auth)) return auth;
  const rows = await asPrincipal(auth.claims, async (tx) => {
    const r = await tx.query(
      `SELECT id, event, rendered_body, created_at::text AS created_at
       FROM notification_deliveries
       WHERE member_id = $1 AND channel = 'in_app'
       ORDER BY created_at DESC LIMIT 50`,
      [auth.memberId],
    );
    return r.rows;
  });
  return NextResponse.json({ notifications: rows });
}

export const GET = withApiLogging('/api/member/v1/notifications', handleGet);
