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
  get sessionSecret(): string {
    const s = required('SESSION_SECRET');
    if (s.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
    return s;
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
