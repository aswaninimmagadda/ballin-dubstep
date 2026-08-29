import 'server-only';
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { env } from './env';
import { asAnonymous, type Claims } from './db';

/**
 * Member app tokens. Access tokens are short-lived HMAC-signed payloads
 * (no DB hit per request); refresh tokens are single-use, DB-backed with
 * rotation + replay revocation (see app.refresh_consume).
 */

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_DAYS = 30;

export interface MemberTokenPayload {
  sub: string; // user id
  tid: string; // tenant id
  mid: string; // member id
  exp: number; // unix seconds
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');

export function signAccessToken(payload: Omit<MemberTokenPayload, 'exp'>): string {
  const body = b64u(
    JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ACCESS_TTL_SECONDS }),
  );
  const sig = createHmac('sha256', env.memberTokenSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyAccessToken(token: string): MemberTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];
  const expected = createHmac('sha256', env.memberTokenSecret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as MemberTokenPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) return null;
    if (!payload.sub || !payload.tid || !payload.mid) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function issueRefreshToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + REFRESH_TTL_DAYS * 86400_000);
  await asAnonymous((tx) =>
    tx.query(`SELECT app.refresh_create($1, $2, $3)`, [
      userId,
      sha256hex(token),
      expires.toISOString(),
    ]),
  );
  return token;
}

/**
 * Rotate a refresh token, returning the new one.
 *
 * One atomic call: the old token is consumed and the new one created in the
 * same transaction, so there is no window where the member holds a spent token
 * and no replacement exists. app.refresh_rotate also tolerates the old token
 * being presented again within a short grace window when its successor was
 * never used — which is what a dropped response looks like, and used to
 * revoke the whole family and strand the member.
 */
export async function rotateRefreshToken(
  token: string,
): Promise<{ userId: string; tenantId: string; refreshToken: string } | null> {
  const next = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + REFRESH_TTL_DAYS * 86400_000);
  const row = await asAnonymous(async (tx) => {
    const r = await tx.query(`SELECT * FROM app.refresh_rotate($1, $2, $3)`, [
      sha256hex(token),
      sha256hex(next),
      expires.toISOString(),
    ]);
    return (r as { rows: Record<string, unknown>[] }).rows[0];
  });
  if (!row || row.kind !== 'member' || !row.is_active) return null;
  // Refresh is the long-lived credential, so it has to apply the same tenant
  // rule as login. Without this a member of a suspended or archived gym kept
  // rotating a fresh 30-day token forever, and the suspension meant nothing.
  const status = row.tenant_status as string | null;
  if (status && status !== 'active' && status !== 'trial') return null;
  return {
    userId: row.user_id as string,
    tenantId: row.tenant_id as string,
    refreshToken: next,
  };
}

/**
 * Hand a refresh token back on sign-out. Revokes the whole family for that
 * user, so the token the app was holding stops working immediately instead of
 * remaining valid on the server for its full 30 days.
 */
export async function revokeRefreshToken(token: string): Promise<void> {
  await asAnonymous((tx) => tx.query(`SELECT app.refresh_revoke_family($1)`, [sha256hex(token)]));
}

export interface MemberAuth {
  claims: Claims;
  memberId: string;
}

/** Authenticate a member API request from its Bearer token. */
export function memberAuth(req: NextRequest): MemberAuth | NextResponse {
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return {
    claims: { sub: payload.sub, tenant_id: payload.tid, kind: 'member' },
    memberId: payload.mid,
  };
}

export function isErrorResponse(x: MemberAuth | NextResponse): x is NextResponse {
  return x instanceof NextResponse;
}
