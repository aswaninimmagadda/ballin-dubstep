import { describe, it, expect } from 'vitest';
import { resolveForwardedFor } from '../src/forwarded-for';

describe('resolveForwardedFor', () => {
  it('ignores the header entirely when no proxy is trusted', () => {
    // The default. A limiter fed a caller-controlled value is worse than none.
    expect(resolveForwardedFor('1.2.3.4', 0)).toBeNull();
    expect(resolveForwardedFor('1.2.3.4', -1)).toBeNull();
    expect(resolveForwardedFor('1.2.3.4', Number.NaN)).toBeNull();
  });

  it('takes the entry the outermost trusted proxy observed, not the client value', () => {
    // One proxy: it appended the real peer, so the real peer is last.
    expect(resolveForwardedFor('203.0.113.9', 1)).toBe('203.0.113.9');
    // The client tried to forge one. The proxy still appended the truth.
    expect(resolveForwardedFor('66.66.66.66, 203.0.113.9', 1)).toBe('203.0.113.9');
  });

  it('steps back one entry per trusted proxy', () => {
    expect(resolveForwardedFor('66.66.66.66, 203.0.113.9, 10.0.0.1', 2)).toBe('203.0.113.9');
    expect(resolveForwardedFor('203.0.113.9, 10.0.0.1', 2)).toBe('203.0.113.9');
  });

  it('attributes nothing when the chain is shorter than the configured hops', () => {
    // Someone reached the app without going through the documented proxies.
    expect(resolveForwardedFor('10.0.0.1', 2)).toBeNull();
    expect(resolveForwardedFor('', 1)).toBeNull();
    expect(resolveForwardedFor(null, 1)).toBeNull();
    expect(resolveForwardedFor(undefined, 1)).toBeNull();
  });

  it('a forged chain cannot reach past the trusted hops', () => {
    // 200 forged entries still resolve to the one the proxy appended.
    const forged = Array.from({ length: 200 }, (_, i) => `10.0.0.${i % 250}`).join(', ');
    expect(resolveForwardedFor(`${forged}, 203.0.113.9`, 1)).toBe('203.0.113.9');
  });

  it('tolerates whitespace and empty entries', () => {
    expect(resolveForwardedFor('  66.66.66.66 ,, 203.0.113.9  ', 1)).toBe('203.0.113.9');
  });
});
