import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derived) =>
      err ? reject(err) : resolve(derived),
    );
  });
}

/**
 * Password hashing with Node's built-in scrypt (RFC 7914). Parameters follow
 * OWASP guidance (N=2^15, r=8, p=1, 32-byte key, 16-byte salt). Stored format
 * is self-describing so parameters can be raised later without breaking old
 * hashes: scrypt$N$r$p$<salt b64>$<hash b64>
 */
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 32;

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 6) throw new Error('Password too short');
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize('NFKC'), salt, KEYLEN, {
    N,
    r: R,
    p: P,
    maxmem: 128 * N * R * 2,
  });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, nStr, rStr, pStr, saltB64, hashB64] = parts as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const n = Number(nStr);
    const r = Number(rStr);
    const p = Number(pStr);
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const derived = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: 128 * n * r * 2,
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
