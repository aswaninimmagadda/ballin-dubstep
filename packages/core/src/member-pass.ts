import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Member QR pass: a rotating HMAC-signed token, never raw PII.
 * Payload: v1.<memberId>.<epochWindow>.<signature>
 * The token is valid for the current and previous rotation window (so a code
 * rendered seconds before rotation still scans). Server re-derives and
 * verifies; nothing sensitive is decodable from the QR itself besides the
 * member UUID, which is meaningless outside the tenant's authenticated API.
 */

const WINDOW_SECONDS = 60;

export function currentWindow(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / WINDOW_SECONDS);
}

function sign(secret: string, memberId: string, window: number): string {
  return createHmac('sha256', secret).update(`v1.${memberId}.${window}`).digest('base64url');
}

export function generateMemberPassToken(
  secret: string,
  memberId: string,
  nowMs = Date.now(),
): string {
  const w = currentWindow(nowMs);
  return `v1.${memberId}.${w}.${sign(secret, memberId, w)}`;
}

export interface PassVerification {
  valid: boolean;
  memberId?: string;
  reason?: 'malformed' | 'expired' | 'bad_signature';
}

export function verifyMemberPassToken(
  secret: string,
  token: string,
  nowMs = Date.now(),
): PassVerification {
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return { valid: false, reason: 'malformed' };
  const [, memberId, windowStr, sig] = parts as [string, string, string, string];
  const window = Number(windowStr);
  if (!Number.isInteger(window)) return { valid: false, reason: 'malformed' };
  const now = currentWindow(nowMs);
  if (window !== now && window !== now - 1) return { valid: false, reason: 'expired' };
  const expected = sign(secret, memberId, window);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: 'bad_signature' };
  }
  return { valid: true, memberId };
}
