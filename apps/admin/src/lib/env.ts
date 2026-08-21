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
}
