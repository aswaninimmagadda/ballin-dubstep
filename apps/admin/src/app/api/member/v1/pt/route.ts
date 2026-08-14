import { NextResponse, type NextRequest } from 'next/server';
import { asPrincipal } from '@/lib/db';
import { isErrorResponse, memberAuth } from '@/lib/member-api';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = memberAuth(req);
  if (isErrorResponse(auth)) return auth;
  const data = await asPrincipal(auth.claims, async (tx) => {
    const addons = await tx.query(
      `SELECT ma.id, ma.name_snapshot, ma.sessions_total, ma.sessions_used,
              ma.start_date::text AS start_date, ma.end_date::text AS end_date, ma.state,
              tp.name AS trainer_name
       FROM member_addons ma
       LEFT JOIN trainer_public tp ON tp.id = ma.trainer_id
       WHERE ma.member_id = $1 ORDER BY ma.created_at DESC`,
      [auth.memberId],
    );
    const sessions = await tx.query(
      `SELECT ts.session_date::text AS session_date, ts.start_time::text AS start_time,
              ts.end_time::text AS end_time, ts.status, tp.name AS trainer_name
       FROM trainer_sessions ts
       LEFT JOIN trainer_public tp ON tp.id = ts.trainer_id
       WHERE ts.member_id = $1
       ORDER BY ts.session_date DESC, ts.start_time DESC LIMIT 30`,
      [auth.memberId],
    );
    return { addons: addons.rows, sessions: sessions.rows };
  });
  return NextResponse.json(data);
}
