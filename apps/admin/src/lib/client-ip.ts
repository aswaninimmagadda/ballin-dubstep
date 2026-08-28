import { resolveForwardedFor } from '@gymflow/core';

/**
 * TRUSTED_PROXY_HOPS says how many reverse proxies in front of this app append
 * to X-Forwarded-For. The parsing rule, and why the left-most entry is the
 * wrong one to take, is documented on resolveForwardedFor in @gymflow/core.
 *
 * The default is 0 — no trusted proxy, so the header is ignored and requests
 * carry no address at all. That deliberately disables per-address throttling
 * rather than running it on a value the caller controls: a limiter that can be
 * bypassed AND aimed at a victim is worse than no limiter. Per-identifier
 * throttling is unaffected and is the one that stops password guessing.
 * docs/DEPLOYMENT.md sets this for the documented Caddy deployment.
 */
export const trustedProxyHops = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? '0', 10);

export function clientIpFromHeaders(h: {
  get(name: string): string | null | undefined;
}): string | null {
  if (!(trustedProxyHops > 0)) return null;
  return (
    resolveForwardedFor(h.get('x-forwarded-for'), trustedProxyHops) ??
    h.get('x-real-ip')?.trim() ??
    null
  );
}
