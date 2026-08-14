/**
 * The auth data path: credential lookup, sessions, refresh rotation,
 * throttling. All through SECURITY DEFINER functions — direct table access
 * for the app role must be impossible.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { setupOnce, appPool, withoutClaims, type Fixtures } from './helpers.js';

let fx: Fixtures;
beforeAll(async () => {
  fx = await setupOnce();
});

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('credential tables are sealed', () => {
  it('app role cannot select credentials/sessions/refresh tokens directly', async () => {
    for (const table of ['user_credentials', 'sessions', 'refresh_tokens', 'login_attempts']) {
      await expect(
        withoutClaims(appPool(), (tx) => tx.query(`SELECT * FROM ${table}`)),
      ).rejects.toThrow(/permission denied/);
    }
  });
});

describe('staff login lookup', () => {
  it('returns hash + tenant for a real user', async () => {
    const row = await withoutClaims(appPool(), async (tx) => {
      const r = await tx.query(`SELECT * FROM app.auth_staff_lookup($1)`, [
        'owner@tenant-a.test.local',
      ]);
      return r.rows[0];
    });
    expect(row.user_id).toBe(fx.a.ownerUserId);
    expect(row.password_hash).toMatch(/^scrypt\$/);
    expect(row.tenant_status).toBe('active');
  });
  it('unknown email returns nothing', async () => {
    const rows = await withoutClaims(appPool(), async (tx) => {
      const r = await tx.query(`SELECT * FROM app.auth_staff_lookup($1)`, ['nobody@nowhere.test']);
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });
});

describe('sessions', () => {
  it('create → lookup → revoke → lookup fails', async () => {
    const token = randomBytes(32).toString('hex');
    await withoutClaims(appPool(), (tx) =>
      tx.query(`SELECT app.session_create($1, $2, now() + interval '12 hours', '127.0.0.1', 'test')`, [
        fx.a.ownerUserId,
        sha(token),
      ]),
    );
    const found = await withoutClaims(appPool(), async (tx) => {
      const r = await tx.query(`SELECT * FROM app.session_lookup($1)`, [sha(token)]);
      return r.rows[0];
    });
    expect(found.user_id).toBe(fx.a.ownerUserId);
    expect(found.kind).toBe('staff');

    await withoutClaims(appPool(), (tx) => tx.query(`SELECT app.session_revoke($1)`, [sha(token)]));
    const gone = await withoutClaims(appPool(), async (tx) => {
      const r = await tx.query(`SELECT * FROM app.session_lookup($1)`, [sha(token)]);
      return r.rows;
    });
    expect(gone).toHaveLength(0);
  });

  it('expired sessions do not resolve', async () => {
    const token = randomBytes(32).toString('hex');
    await withoutClaims(appPool(), (tx) =>
      tx.query(`SELECT app.session_create($1, $2, now() - interval '1 minute', NULL, NULL)`, [
        fx.a.ownerUserId,
        sha(token),
      ]),
    );
    const rows = await withoutClaims(appPool(), async (tx) => {
      const r = await tx.query(`SELECT * FROM app.session_lookup($1)`, [sha(token)]);
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });
});

describe('refresh token rotation', () => {
  it('consume once succeeds, replay revokes the whole family', async () => {
    const t1 = sha(randomBytes(32).toString('hex'));
    const t2 = sha(randomBytes(32).toString('hex'));
    await withoutClaims(appPool(), (tx) =>
      tx.query(`SELECT app.refresh_create($1, $2, now() + interval '30 days')`, [
        fx.a.memberUserId, t1,
      ]),
    );
    const first = await withoutClaims(appPool(), async (tx) => {
      const r = await tx.query(`SELECT * FROM app.refresh_consume($1)`, [t1]);
      return r.rows;
    });
    expect(first).toHaveLength(1);
    expect(first[0].user_id).toBe(fx.a.memberUserId);

    // issue a successor token
    await withoutClaims(appPool(), (tx) =>
      tx.query(`SELECT app.refresh_create($1, $2, now() + interval '30 days')`, [
        fx.a.memberUserId, t2,
      ]),
    );

    // replay of t1 → empty AND revokes t2
    const replay = await withoutClaims(appPool(), async (tx) => {
      const r = await tx.query(`SELECT * FROM app.refresh_consume($1)`, [t1]);
      return r.rows;
    });
    expect(replay).toHaveLength(0);
    const successor = await withoutClaims(appPool(), async (tx) => {
      const r = await tx.query(`SELECT * FROM app.refresh_consume($1)`, [t2]);
      return r.rows;
    });
    expect(successor).toHaveLength(0); // family revoked
  });
});

describe('login throttling', () => {
  it('counts recent failures by identifier and ip', async () => {
    for (let i = 0; i < 3; i++) {
      await withoutClaims(appPool(), (tx) =>
        tx.query(`SELECT app.record_login_attempt('victim@test.local', '10.0.0.9', false)`),
      );
    }
    await withoutClaims(appPool(), (tx) =>
      tx.query(`SELECT app.record_login_attempt('victim@test.local', '10.0.0.9', true)`),
    );
    const failures = await withoutClaims(appPool(), async (tx) => {
      const r = await tx.query(
        `SELECT app.recent_failed_attempts('victim@test.local', '10.0.0.9', interval '15 minutes') AS n`,
      );
      return Number(r.rows[0].n);
    });
    expect(failures).toBe(3);
  });
});
