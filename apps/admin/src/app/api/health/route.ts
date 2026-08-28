import { NextResponse } from 'next/server';
import { asAnonymous } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Liveness + database readiness, for uptime monitoring and post-deploy
 * verification. Deliberately says nothing about versions, schema or
 * connection strings — an unauthenticated endpoint should not help an
 * attacker fingerprint the stack.
 */
export async function GET(): Promise<NextResponse> {
  try {
    await asAnonymous(async (tx) => tx.query('SELECT 1'));
    return NextResponse.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json(
      { status: 'unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
