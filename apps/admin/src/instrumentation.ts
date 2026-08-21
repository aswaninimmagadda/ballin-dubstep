/**
 * Next.js runs this once when the server starts. Validating configuration
 * here means a missing secret stops the deploy instead of surfacing later as
 * an opaque 500 on a member's phone.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertEnv } = await import('./lib/env');
    assertEnv();
  }
}
