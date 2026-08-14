import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/password.js';

describe('password hashing (scrypt)', () => {
  it('hashes and verifies', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h.startsWith('scrypt$32768$8$1$')).toBe(true);
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('wrong password', h)).toBe(false);
  });
  it('never stores the plaintext and salts uniquely', async () => {
    const h1 = await hashPassword('secret-password');
    const h2 = await hashPassword('secret-password');
    expect(h1).not.toContain('secret-password');
    expect(h1).not.toBe(h2); // unique salts
  });
  it('rejects malformed stored hashes safely', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$bad')).toBe(false);
  });
  it('unicode normalization is applied', async () => {
    // "é" composed vs decomposed must verify identically
    const h = await hashPassword('café-password');
    expect(await verifyPassword('café-password', h)).toBe(true);
  });
});
