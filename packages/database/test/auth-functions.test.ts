/**
 * The auth data path: credential lookup, sessions, refresh rotation,
 * throttling. All through SECURITY DEFINER functions — direct table access
 * for the app role must be impossible.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import {
  setupOnce,
  appPool,
  withClaims,
  withoutClaims,
  staffClaims,
  type Fixtures,
} from './helpers';

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
      tx.query(
        `SELECT app.session_create($1, $2, now() + interval '12 hours', '127.0.0.1', 'test')`,
        [fx.a.ownerUserId, sha(token)],
      ),
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
        fx.a.memberUserId,
        t1,
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
        fx.a.memberUserId,
        t2,
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

  // A gym is behind one public IP and its staff share a LAN. Counting an
  // address's failures against an individual would let one member's forgotten
  // password lock out the whole front desk, so the two are counted apart.
  it('keeps identifier and ip counts separate (migration 0011)', async () => {
    const SHARED_IP = '203.0.113.77';
    for (let i = 0; i < 9; i++) {
      await withoutClaims(appPool(), (tx) =>
        tx.query(`SELECT app.record_login_attempt($1, $2, false)`, [
          `member${i}@shared.local`,
          SHARED_IP,
        ]),
      );
    }
    const counts = await withoutClaims(appPool(), async (tx) => {
      const r = await tx.query(
        `SELECT by_identifier, by_ip
         FROM app.login_attempt_counts($1, $2, interval '15 minutes')`,
        ['reception@shared.local', SHARED_IP],
      );
      return r.rows[0] as { by_identifier: string; by_ip: string };
    });
    // Reception has never failed, even though nine others did from this IP.
    expect(Number(counts.by_identifier)).toBe(0);
    expect(Number(counts.by_ip)).toBe(9);

    // The legacy helper must no longer fold the IP into the identifier count.
    const legacy = await withoutClaims(appPool(), async (tx) => {
      const r = await tx.query(
        `SELECT app.recent_failed_attempts($1, $2, interval '15 minutes') AS n`,
        ['reception@shared.local', SHARED_IP],
      );
      return Number(r.rows[0].n);
    });
    expect(legacy).toBe(0);
  });
});

describe('password function scoping (migration 0008)', () => {
  const FAKE_HASH =
    'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

  it('receptionist (members.edit) can set a MEMBER password', async () => {
    await expect(
      withClaims(appPool(), staffClaims(fx.a, 'receptionist'), (tx) =>
        tx.query(`SELECT app.auth_set_password($1, $2)`, [fx.a.memberUserId, FAKE_HASH]),
      ),
    ).resolves.toBeDefined();
  });

  it('receptionist can NOT overwrite a staff password (no takeover of the owner)', async () => {
    await expect(
      withClaims(appPool(), staffClaims(fx.a, 'receptionist'), (tx) =>
        tx.query(`SELECT app.auth_set_password($1, $2)`, [fx.a.ownerUserId, FAKE_HASH]),
      ),
    ).rejects.toThrow(/not authorized/);
  });

  it('owner (staff.manage) can reset staff passwords within the tenant only', async () => {
    await expect(
      withClaims(appPool(), staffClaims(fx.a, 'owner'), (tx) =>
        tx.query(`SELECT app.auth_set_password($1, $2)`, [fx.a.receptionistUserId, FAKE_HASH]),
      ),
    ).resolves.toBeDefined();
    await expect(
      withClaims(appPool(), staffClaims(fx.a, 'owner'), (tx) =>
        tx.query(`SELECT app.auth_set_password($1, $2)`, [fx.b.ownerUserId, FAKE_HASH]),
      ),
    ).rejects.toThrow(/not authorized/);
  });
});
