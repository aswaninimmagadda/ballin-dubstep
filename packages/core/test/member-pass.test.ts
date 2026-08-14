import { describe, it, expect } from 'vitest';
import { generateMemberPassToken, verifyMemberPassToken } from '../src/member-pass';

const SECRET = 'test-secret-at-least-32-bytes-long!!';
const MEMBER = '2b0a3c1e-0000-4000-8000-000000000001';

describe('member QR pass tokens', () => {
  it('round-trips a fresh token', () => {
    const t = generateMemberPassToken(SECRET, MEMBER);
    expect(verifyMemberPassToken(SECRET, t)).toEqual({ valid: true, memberId: MEMBER });
  });
  it('accepts previous window (just rotated)', () => {
    const now = Date.now();
    const t = generateMemberPassToken(SECRET, MEMBER, now - 61_000);
    expect(verifyMemberPassToken(SECRET, t, now).valid).toBe(true);
  });
  it('rejects stale tokens (replay protection)', () => {
    const now = Date.now();
    const t = generateMemberPassToken(SECRET, MEMBER, now - 5 * 60_000);
    expect(verifyMemberPassToken(SECRET, t, now)).toEqual({ valid: false, reason: 'expired' });
  });
  it('rejects tampered member IDs', () => {
    const t = generateMemberPassToken(SECRET, MEMBER);
    const forged = t.replace(MEMBER, '2b0a3c1e-0000-4000-8000-000000000002');
    expect(verifyMemberPassToken(SECRET, forged).valid).toBe(false);
  });
  it('rejects wrong secret', () => {
    const t = generateMemberPassToken(SECRET, MEMBER);
    expect(verifyMemberPassToken('another-secret-32-bytes-long!!!!!!', t).valid).toBe(false);
  });
  it('rejects malformed tokens', () => {
    expect(verifyMemberPassToken(SECRET, 'garbage').reason).toBe('malformed');
  });
  it('token contains no PII beyond an opaque UUID', () => {
    const t = generateMemberPassToken(SECRET, MEMBER);
    expect(t).not.toMatch(/[6-9]\d{9}/); // no phone numbers
  });
});
