import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { revokeRefreshToken, withApiLogging } from '@/lib/member-api';

export const dynamic = 'force-dynamic';

const schema = z.object({ refreshToken: z.string().min(20).max(200) });

/**
 * Sign out for real. The app used to just drop its copy of the tokens, which
 * left a valid 30-day refresh token on the server — anyone who had lifted it
 * (a shared phone, a backup) could keep minting sessions after the member
 * thought they had signed out.
 *
 * Answers 204 either way: whether a token existed is not something an
 * unauthenticated caller should be able to probe.
 */
async function handlePost(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  const parsed = schema.safeParse(body);
  if (parsed.success) await revokeRefreshToken(parsed.data.refreshToken);
  return new NextResponse(null, { status: 204 });
}

export const POST = withApiLogging('/api/member/v1/logout', handlePost);
