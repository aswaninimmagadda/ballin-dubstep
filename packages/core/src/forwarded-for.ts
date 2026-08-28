/**
 * Resolving a caller's address from an X-Forwarded-For chain.
 *
 * The obvious implementation — take the left-most entry — is exactly wrong.
 * Every standard reverse proxy (Caddy's `reverse_proxy`, nginx's
 * `proxy_add_x_forwarded_for`) APPENDS its own observation of the peer to the
 * right of whatever arrived, so the left-most entry is whatever the client
 * typed and only the right-most entries were actually observed. Trusting the
 * left-most value lets a caller rotate the header to defeat per-address
 * throttling, and lets them pin a victim's address to lock a whole gym out.
 *
 * `hops` is how many proxies in front of the app append to the header. The
 * caller's address is that many entries from the end.
 */
export function resolveForwardedFor(
  header: string | null | undefined,
  hops: number,
): string | null {
  if (!Number.isFinite(hops) || hops <= 0) return null;
  if (!header) return null;
  const chain = header
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const idx = chain.length - hops;
  // A chain shorter than the deployment claims means the request did not come
  // through the expected proxies. Attribute nothing rather than guess: a wrong
  // attribution is what makes a limiter aimable at a victim.
  if (idx < 0) return null;
  return chain[idx] ?? null;
}
