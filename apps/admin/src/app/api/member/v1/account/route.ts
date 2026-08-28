import { NextResponse, type NextRequest } from 'next/server';
import { asPrincipal } from '@/lib/db';
import { isErrorResponse, memberAuth } from '@/lib/member-api';

export const dynamic = 'force-dynamic';

/**
 * Member-initiated account deletion (Apple 5.1.1(v), Google Play).
 *
 * Deletes the member's login — credentials, roles, sessions and the user row
 * itself — so they can no longer sign in, and files a data-deletion request
 * for the gym. Gym records (membership, payments, receipts) are deliberately
 * NOT touched: they are append-only financial records the gym is obliged to
 * keep, and the app tells the member so before they confirm.
 */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const auth = memberAuth(req);
  if (isErrorResponse(auth)) return auth;
  await asPrincipal(auth.claims, async (tx) => {
    await tx.query(`SELECT app.member_delete_account()`);
  });
  return NextResponse.json({
    deleted: true,
    message:
      'Your app account has been deleted and you have been signed out. Your gym has been asked to erase your remaining personal details; membership and payment records are kept as the law requires.',
  });
}
