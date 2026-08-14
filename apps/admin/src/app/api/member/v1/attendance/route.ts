import { NextResponse, type NextRequest } from 'next/server';
import { asPrincipal } from '@/lib/db';
import { isErrorResponse, memberAuth } from '@/lib/member-api';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = memberAuth(req);
  if (isErrorResponse(auth)) return auth;
  const rows = await asPrincipal(auth.claims, async (tx) => {
    const r = await tx.query(
      `SELECT checked_in_at::text AS checked_in_at, method
       FROM attendance WHERE member_id = $1
       ORDER BY checked_in_at DESC LIMIT 60`,
      [auth.memberId],
    );
    return r.rows;
  });
  return NextResponse.json({ attendance: rows });
}
