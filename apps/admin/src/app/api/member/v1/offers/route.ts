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
       WHERE is_active AND CURRENT_DATE BETWEEN valid_from AND valid_to
       ORDER BY valid_to ASC`,
    );
    return r.rows;
  });
  return NextResponse.json({ offers: rows });
}
