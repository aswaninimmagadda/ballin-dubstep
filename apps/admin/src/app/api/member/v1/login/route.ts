import { NextResponse, type NextRequest } from 'next/server';
import { verifyPassword } from '@gymflow/core';
import { memberLoginSchema } from '@gymflow/validation';
import { asAnonymous } from '@/lib/db';
import { issueRefreshToken, signAccessToken } from '@/lib/member-api';

export const dynamic = 'force-dynamic';

const MAX_FAILED = 8;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = memberLoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { gymCode, mobile, password } = parsed.data;
  const identifier = `${gymCode}:${mobile}`;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  const failures = await asAnonymous(async (tx) => {
    const r = await tx.query(
      `SELECT app.recent_failed_attempts($1, $2, interval '15 minutes') AS n`,
      [identifier, ip],
    );
    return Number((r as { rows: { n: string }[] }).rows[0]?.n ?? 0);
  });
  if (failures >= MAX_FAILED) {
    return NextResponse.json({ error: 'locked' }, { status: 429 });
  }

  const row = await asAnonymous(async (tx) => {
    const r = await tx.query(`SELECT * FROM app.auth_member_lookup($1, $2)`, [gymCode, mobile]);
    return (r as { rows: Record<string, unknown>[] }).rows[0];
  });

  const record = (ok: boolean) =>
    asAnonymous((tx) => tx.query(`SELECT app.record_login_attempt($1, $2, $3)`, [identifier, ip, ok]));

  if (!row || !(await verifyPassword(password, row.password_hash as string))) {
    await record(false);
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }
  if (!row.is_active || !row.member_id || (row.tenant_status && !['active', 'trial'].includes(row.tenant_status as string))) {
    await record(false);
    return NextResponse.json({ error: 'account_unavailable' }, { status: 403 });
  }
  await record(true);

  const accessToken = signAccessToken({
    sub: row.user_id as string,
    tid: row.tenant_id as string,
    mid: row.member_id as string,
  });
  const refreshToken = await issueRefreshToken(row.user_id as string);
  return NextResponse.json({
    accessToken,
    refreshToken,
    displayName: row.display_name,
    language: row.language,
  });
}
