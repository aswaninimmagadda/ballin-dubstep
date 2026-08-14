import pg from 'pg';

/**
 * Claims-scoped database access. Every application query runs inside a
 * transaction whose `request.jwt.claims` setting identifies the principal —
 * the same mechanism Supabase/PostgREST uses — so Row Level Security is the
 * enforcement layer, not application WHERE clauses.
 */

export interface Claims {
  /** user id */
  sub: string;
  tenant_id: string | null;
  kind: 'platform_admin' | 'staff' | 'member';
}

export type Queryable = Pick<pg.ClientBase, 'query'>;

export function createPool(connectionString: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString, max, idleTimeoutMillis: 30_000 });
}

/**
 * Run `fn` in a transaction with the given claims applied (transaction-local,
 * so nothing leaks between pooled connections). Rolls back on any throw.
 */
export async function withClaims<T>(
  pool: pg.Pool,
  claims: Claims,
  fn: (tx: Queryable) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // set_config with is_local=true scopes the claims to this transaction.
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(claims),
    ]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection-level failure; release below */
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Run without claims (auth path: only SECURITY DEFINER functions work). */
export async function withoutClaims<T>(
  pool: pg.Pool,
  fn: (tx: Queryable) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}
