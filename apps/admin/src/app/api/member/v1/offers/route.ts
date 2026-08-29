import { NextResponse, type NextRequest } from 'next/server';
import { asPrincipal } from '@/lib/db';
import { isErrorResponse, memberAuth } from '@/lib/member-api';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = memberAuth(req);
  if (isErrorResponse(auth)) return auth;
  const rows = await asPrincipal(auth.claims, async (tx) => {
    const r = await tx.query(
      `SELECT code, name, discount_kind, discount_value::bigint::text AS discount_value,
              valid_to::text AS valid_to
       FROM promotions
       -- The gym's calendar day, not the server's: an offer valid "until the
       -- 31st" must still show at 11pm IST on the 31st, which is already the
       -- 1st in UTC.
       WHERE is_active
         AND (now() AT TIME ZONE (
               SELECT t.default_timezone FROM tenants t
                WHERE t.id = (SELECT app.current_tenant_id())
             ))::date BETWEEN valid_from AND valid_to
       ORDER BY valid_to ASC`,
    );
    return r.rows;
  });
  return NextResponse.json({ offers: rows });
}
