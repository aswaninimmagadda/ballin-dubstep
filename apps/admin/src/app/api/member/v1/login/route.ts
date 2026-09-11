import { NextResponse, type NextRequest } from 'next/server';
import { verifyPassword, verifyPasswordDecoy } from '@gymflow/core';
import { memberLoginSchema } from '@gymflow/validation';
import { clientIpFromHeaders } from '@/lib/client-ip';
import { asAnonymous } from '@/lib/db';
import { issueRefreshToken, signAccessToken, withApiLogging } from '@/lib/member-api';
import { isThrottled } from '@/lib/session';

export const dynamic = 'force-dynamic';

async function handlePost(req: NextRequest): Promise<NextResponse> {
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
  const ip = clientIpFromHeaders(req.headers);

  // Per-identifier and per-IP limits are separate: a gym shares one address,
  // so a member's forgotten password must not lock everyone else out.
  if (await isThrottled(identifier, ip)) {
    return NextResponse.json({ error: 'locked' }, { status: 429 });
  }

  // A gym code that does not exist is worth saying out loud. It is the field
  // members get wrong most often — it is not their phone number and not their
  // password, and answering "those do not match" sends them to check the two
  // things that were right. It gives nothing away either: the gym directory
  // is already public, which is what app.public_gym_contact exists for and
  // what the account-deletion page uses.
  //
  // The member-existence defence below is untouched: once the gym resolves,
  // a registered and an unregistered mobile still cost the same scrypt.
  const record = (ok: boolean) =>
    asAnonymous((tx) =>
      tx.query(`SELECT app.record_login_attempt($1, $2, $3)`, [identifier, ip, ok]),
    );

  const gymState = await asAnonymous(async (tx) => {
    const r = await tx.query(`SELECT app.public_gym_signin_state($1) AS state`, [gymCode]);
    return (r as { rows: { state: string }[] }).rows[0]?.state ?? 'unknown';
  });
  if (gymState === 'closed') {
    // The gym exists; its own account is not active. Saying "no gym with
    // that code" here sent the member back to re-check the one thing they
    // had typed correctly. The message does not say WHY the gym is closed:
    // whether a gym is behind on its bill is not for an unauthenticated
    // endpoint to publish.
    await record(false);
    return NextResponse.json({ error: 'gym_unavailable' }, { status: 403 });
  }
  if (gymState === 'unknown') {
    // Record it like any other failure. This branch returned before `record`
    // was even in scope, so a wrong gym code was the one way to call this
    // endpoint for free — no attempt logged, nothing counted towards a
    // lockout, and nothing in the audit trail.
    //
    // Note what this does and does not buy: the identifier is
    // `gymCode:mobile`, so someone walking the slug namespace changes the
    // identifier every request and never trips the per-identifier limit. The
    // per-address limit is what catches that, and it only runs when
    // TRUSTED_PROXY_HOPS is set (see docs/DEPLOYMENT.md). What this fixes is
    // the free-and-invisible part.
    await record(false);
    return NextResponse.json({ error: 'gym_not_found' }, { status: 404 });
  }

  const row = await asAnonymous(async (tx) => {
    const r = await tx.query(`SELECT * FROM app.auth_member_lookup($1, $2)`, [gymCode, mobile]);
    return (r as { rows: Record<string, unknown>[] }).rows[0];
  });

  // Same scrypt cost whether or not the mobile is registered at this gym —
  // short-circuiting here made the endpoint an account-existence oracle.
  const passwordOk = row
    ? await verifyPassword(password, row.password_hash as string)
    : await verifyPasswordDecoy(password);
  if (!row || !passwordOk) {
    await record(false);
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }
  if (
    !row.is_active ||
    !row.member_id ||
    (row.tenant_status && !['active', 'trial'].includes(row.tenant_status as string))
  ) {
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

export const POST = withApiLogging('/api/member/v1/login', handlePost);
