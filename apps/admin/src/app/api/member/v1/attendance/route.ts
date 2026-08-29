import { NextResponse, type NextRequest } from 'next/server';
import { asPrincipal } from '@/lib/db';
import { isErrorResponse, memberAuth } from '@/lib/member-api';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = memberAuth(req);
  if (isErrorResponse(auth)) return auth;
  const rows = await asPrincipal(auth.claims, async (tx) => {
    const r = await tx.query(
      // The member app groups these by day and prints them. Sending the raw
      // UTC instant put an 06:30 IST check-in on the previous day for anyone
      // training before 05:30, and the whole product is otherwise careful to
      // use the tenant's calendar day.
      `SELECT (checked_in_at AT TIME ZONE (
                 SELECT t.default_timezone FROM tenants t
                  WHERE t.id = (SELECT app.current_tenant_id())
               ))::text AS checked_in_at, method
       FROM attendance WHERE member_id = $1
       ORDER BY checked_in_at DESC LIMIT 60`,
      [auth.memberId],
    );
    return r.rows;
  });
  return NextResponse.json({ attendance: rows });
}
