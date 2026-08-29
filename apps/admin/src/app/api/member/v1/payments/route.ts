import { NextResponse, type NextRequest } from 'next/server';
import { asPrincipal } from '@/lib/db';
import { isErrorResponse, memberAuth, withApiLogging } from '@/lib/member-api';

export const dynamic = 'force-dynamic';

async function handleGet(req: NextRequest): Promise<NextResponse> {
  const auth = memberAuth(req);
  if (isErrorResponse(auth)) return auth;
  const rows = await asPrincipal(auth.claims, async (tx) => {
    const r = await tx.query(
      `SELECT p.id, p.amount::bigint::text AS amount, p.method, p.status,
              p.payment_date::text AS payment_date, r.receipt_number
       FROM payments p LEFT JOIN receipts r ON r.payment_id = p.id
       WHERE p.member_id = $1
       ORDER BY p.payment_date DESC, p.created_at DESC LIMIT 50`,
      [auth.memberId],
    );
    return r.rows;
  });
  return NextResponse.json({ payments: rows });
}

export const GET = withApiLogging('/api/member/v1/payments', handleGet);
