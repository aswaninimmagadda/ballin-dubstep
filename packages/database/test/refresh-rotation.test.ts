/**
 * Refresh-token rotation: it must tolerate a dropped response without
 * tolerating a real replay. The two look identical at the first request and
 * are told apart by whether the successor was ever used.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import pg from 'pg';
import { setupOnce, OWNER_URL, type Fixtures } from './helpers';

let fx: Fixtures;
let db: pg.Client;

beforeAll(async () => {
  fx = await setupOnce();
});

async function owner(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: OWNER_URL });
  await c.connect();
  return c;
}

afterEach(async () => {
  if (db) {
    await db.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [fx.a.memberUserId]);
    await db.end();
  }
});

const EXPIRES = `now() + interval '30 days'`;

async function seedToken(hash: string): Promise<void> {
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, ${EXPIRES})`,
    [fx.a.memberUserId, hash],
  );
}

async function rotate(oldHash: string, newHash: string, grace = '60 seconds') {
  const r = await db.query(`SELECT * FROM app.refresh_rotate($1, $2, ${EXPIRES}, $3::interval)`, [
    oldHash,
    newHash,
    grace,
  ]);
  return r.rows[0] as { user_id: string } | undefined;
}

describe('refresh rotation', () => {
  it('rotates an unused token and issues the replacement atomically', async () => {
    db = await owner();
    await seedToken('t1');
    const out = await rotate('t1', 't2');
    expect(out?.user_id).toBe(fx.a.memberUserId);
    const { rows } = await db.query(
      `SELECT token_hash, used_at IS NOT NULL AS used, replaced_by IS NOT NULL AS linked
         FROM refresh_tokens WHERE user_id = $1 ORDER BY created_at`,
      [fx.a.memberUserId],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ token_hash: 't1', used: true, linked: true });
    expect(rows[1]).toMatchObject({ token_hash: 't2', used: false });
  });

  it('tolerates a dropped response: the same token again mints a fresh pair', async () => {
    // The member's phone never received t2, so it retries with t1. Before this
    // was handled, that revoked the whole family and stranded them.
    db = await owner();
    await seedToken('t1');
    expect((await rotate('t1', 't2'))?.user_id).toBe(fx.a.memberUserId);
    const retry = await rotate('t1', 't3');
    expect(retry?.user_id).toBe(fx.a.memberUserId);

    const { rows } = await db.query(
      `SELECT token_hash, used_at IS NOT NULL AS used, revoked_at IS NOT NULL AS revoked
         FROM refresh_tokens WHERE user_id = $1 ORDER BY created_at`,
      [fx.a.memberUserId],
    );
    // t2 was minted and never delivered, so it is retired. t3 is the only
    // token that can be presented normally. t1 stays used-but-unrevoked on
    // purpose: if the response carrying t3 is ALSO dropped, the same grace
    // path has to work again — bounded by the window measured from its first
    // use, so it cannot be replayed indefinitely.
    const usable = rows.filter((r) => !r.used && !r.revoked).map((r) => r.token_hash);
    expect(usable).toEqual(['t3']);
    expect(rows.find((r) => r.token_hash === 't2')?.revoked).toBe(true);
  });

  it('treats reuse after the grace window as a replay and revokes the family', async () => {
    db = await owner();
    await seedToken('t1');
    await rotate('t1', 't2');
    const replay = await rotate('t1', 't3', '0 seconds');
    expect(replay).toBeUndefined();
    const { rows } = await db.query(
      `SELECT count(*)::int AS live FROM refresh_tokens
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [fx.a.memberUserId],
    );
    expect(rows[0].live).toBe(0);
  });

  it('treats reuse after the successor was used as a replay, even inside the window', async () => {
    // The legitimate client got t2 and moved on, so whoever still holds t1 is
    // not that client. This is the case the grace window must NOT cover.
    db = await owner();
    await seedToken('t1');
    await rotate('t1', 't2');
    await rotate('t2', 't3');
    const replay = await rotate('t1', 't4');
    expect(replay).toBeUndefined();
    const { rows } = await db.query(
      `SELECT count(*)::int AS live FROM refresh_tokens
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [fx.a.memberUserId],
    );
    expect(rows[0].live).toBe(0);
  });

  it('refuses an expired or revoked token without touching the family', async () => {
    db = await owner();
    await db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, 'expired', now() - interval '1 day'), ($1, 'good', ${EXPIRES})`,
      [fx.a.memberUserId],
    );
    expect(await rotate('expired', 'new')).toBeUndefined();
    const { rows } = await db.query(
      `SELECT count(*)::int AS live FROM refresh_tokens
        WHERE user_id = $1 AND revoked_at IS NULL AND token_hash = 'good'`,
      [fx.a.memberUserId],
    );
    expect(rows[0].live).toBe(1);
  });
});
