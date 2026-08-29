/**
 * Environment access with startup validation. Secrets are read exactly here —
 * never scattered through the codebase — and never sent to the client.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

export const env = {
  get databaseAppUrl(): string {
    return required('DATABASE_APP_URL');
  },
  get memberTokenSecret(): string {
    const s = required('MEMBER_TOKEN_SECRET');
    if (s.length < 32) throw new Error('MEMBER_TOKEN_SECRET must be at least 32 characters');
    return s;
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  },
};

/**
 * Touch every required secret once at boot.
 *
 * The getters above validate lazily, so a missing or too-short
 * MEMBER_TOKEN_SECRET used to start cleanly and pass a staff smoke test —
 * then surface days later as a 500 the first time a member opened the app or
 * reception scanned a pass. Called from instrumentation.ts so a bad
 * configuration fails immediately, with the message naming the variable.
 *
 * Note there is deliberately no SESSION_SECRET: staff session tokens are
 * 256-bit random values stored as SHA-256 hashes, so nothing signs a cookie
 * and no such secret is needed.
 */
export function assertEnv(): void {
  void env.databaseAppUrl;
  void env.memberTokenSecret;

  // TRUSTED_PROXY_HOPS decides whether per-address login throttling works at
  // all, and every unparseable value ("one", "true", "yes", an unexpanded
  // "$HOPS") parses to NaN and takes the same silent path as "unset" — the
  // limiter off, and audit_logs.ip NULL for every action. A number typed
  // wrongly should stop the boot, not quietly disable a control.
  const hops = process.env.TRUSTED_PROXY_HOPS;
  if (hops !== undefined && hops.trim() !== '') {
    if (!/^\d+$/.test(hops.trim())) {
      throw new Error(
        `TRUSTED_PROXY_HOPS must be a whole number (got "${hops}"). It is the count of ` +
          'reverse proxies in front of this app; leave it unset if there are none.',
      );
    }
    if (Number(hops) > 5) {
      throw new Error(
        `TRUSTED_PROXY_HOPS is ${hops}, which is more proxies than any real deployment ` +
          'has. Count only the proxies that append to X-Forwarded-For.',
      );
    }
  } else if (env.isProduction) {
    console.warn(
      '[gymflow] TRUSTED_PROXY_HOPS is unset: per-address login throttling is OFF and ' +
        'audit entries will carry no IP. Set it to the number of reverse proxies in ' +
        'front of this app (Caddy or nginx = 1). See docs/DEPLOYMENT.md.',
    );
  }
}
