import { NextResponse, type NextRequest } from 'next/server';
import { generateMemberPassToken } from '@gymflow/core';
import { env } from '@/lib/env';
import { isErrorResponse, memberAuth, withApiLogging } from '@/lib/member-api';

export const dynamic = 'force-dynamic';

/** Rotating QR pass token (60s window, previous window accepted). */
function handleGet(req: NextRequest): NextResponse {
  const auth = memberAuth(req);
  if (isErrorResponse(auth)) return auth;
  const token = generateMemberPassToken(env.memberTokenSecret, auth.memberId);
  return NextResponse.json({ token, rotatesInSeconds: 60 });
}

export const GET = withApiLogging('/api/member/v1/pass', async (req) => handleGet(req));
