import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { asAnonymous } from '@/lib/db';
import { rotateRefreshToken, signAccessToken } from '@/lib/member-api';

export const dynamic = 'force-dynamic';

const schema = z.object({ refreshToken: z.string().min(20).max(200) });

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const rotated = await rotateRefreshToken(parsed.data.refreshToken);
  if (!rotated) return NextResponse.json({ error: 'invalid_refresh' }, { status: 401 });

  const member = await asAnonymous(async (tx) => {
    const r = await tx.query(`SELECT * FROM app.auth_member_by_user($1)`, [rotated.userId]);
    return (r as { rows: { member_id: string }[] }).rows[0];
  });
  if (!member) return NextResponse.json({ error: 'invalid_refresh' }, { status: 401 });

  const accessToken = signAccessToken({
    sub: rotated.userId,
    tid: rotated.tenantId,
    mid: member.member_id,
  });
  // The replacement was minted inside the same transaction that spent the old
  // one, so there is no half-rotated state to recover from.
  return NextResponse.json({ accessToken, refreshToken: rotated.refreshToken });
}
