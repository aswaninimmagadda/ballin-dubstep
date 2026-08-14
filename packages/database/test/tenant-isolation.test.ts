/**
 * RELEASE-BLOCKING: Tenant A must not be able to read, modify, or infer
 * Tenant B's data through any table. These tests run as the real runtime
 * role (gymflow_app) so RLS is what is actually being exercised.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  setupOnce,
  appPool,
  closePools,
  withClaims,
  withoutClaims,
  staffClaims,
  memberClaims,
  platformClaims,
  type Fixtures,
} from './helpers';

let fx: Fixtures;

beforeAll(async () => {
  fx = await setupOnce();
});
afterAll(async () => {
  await closePools();
});

describe('staff cannot cross tenants', () => {
  const TABLES = [
    'members',
    'memberships',
    'payments',
    'receipts',
    'attendance',
    'leads',
    'promotions',
    'membership_plans',
    'trainers',
    'audit_logs',
  ];

  it('tenant A staff sees only tenant A rows in every business table', async () => {
    for (const table of TABLES) {
      const rows = await withClaims(appPool(), staffClaims(fx.a, 'owner'), async (tx) => {
        const r = await tx.query(`SELECT tenant_id FROM ${table}`);
        return r.rows as { tenant_id: string }[];
      });
      for (const row of rows) {
        expect(row.tenant_id, `${table} leaked a foreign tenant row`).toBe(fx.a.tenantId);
      }
    }
  });

  it('tenant A staff cannot fetch a tenant B member by exact id', async () => {
    const rows = await withClaims(appPool(), staffClaims(fx.a, 'owner'), async (tx) => {
      const r = await tx.query(`SELECT * FROM members WHERE id = $1`, [fx.b.memberId]);
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('tenant A staff cannot update a tenant B member (0 rows affected)', async () => {
    const count = await withClaims(appPool(), staffClaims(fx.a, 'owner'), async (tx) => {
      const r = await tx.query(`UPDATE members SET notes = 'pwned' WHERE id = $1`, [fx.b.memberId]);
      return r.rowCount;
    });
    expect(count).toBe(0);
    // and the row is untouched
    const note = await withClaims(appPool(), staffClaims(fx.b, 'owner'), async (tx) => {
      const r = await tx.query(`SELECT notes FROM members WHERE id = $1`, [fx.b.memberId]);
      return r.rows[0]?.notes;
    });
    expect(note).toBeNull();
  });

  it('tenant A staff cannot INSERT a row stamped with tenant B', async () => {
    await expect(
      withClaims(appPool(), staffClaims(fx.a, 'owner'), (tx) =>
        tx.query(
          `INSERT INTO members (tenant_id, branch_id, membership_number, first_name, mobile)
           VALUES ($1, $2, 'HACK1', 'Intruder', '+919999999999')`,
          [fx.b.tenantId, fx.b.branchId],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('tenant A staff cannot read tenant B gym settings or update them', async () => {
    const rows = await withClaims(appPool(), staffClaims(fx.a, 'owner'), async (tx) => {
      const r = await tx.query(`SELECT * FROM gym_settings WHERE tenant_id = $1`, [fx.b.tenantId]);
      return r.rows;
    });
    expect(rows).toHaveLength(0);
    const updated = await withClaims(appPool(), staffClaims(fx.a, 'owner'), async (tx) => {
      const r = await tx.query(
        `UPDATE gym_settings SET receipt_prefix = 'HAK' WHERE tenant_id = $1`,
        [fx.b.tenantId],
      );
      return r.rowCount;
    });
    expect(updated).toBe(0);
  });

  it('tenant A staff cannot see tenant B users (no email harvesting)', async () => {
    const rows = await withClaims(appPool(), staffClaims(fx.a, 'owner'), async (tx) => {
      const r = await tx.query(`SELECT * FROM users WHERE tenant_id = $1`, [fx.b.tenantId]);
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });
});

describe('members see only themselves', () => {
  it('member sees exactly their own member row', async () => {
    const rows = await withClaims(appPool(), memberClaims(fx.a), async (tx) => {
      const r = await tx.query(`SELECT id FROM members`);
      return r.rows as { id: string }[];
    });
    expect(rows.map((r) => r.id)).toEqual([fx.a.memberId]);
  });

  it('member sees only their own payments/memberships, none from tenant B', async () => {
    const res = await withClaims(appPool(), memberClaims(fx.a), async (tx) => {
      const pays = await tx.query(`SELECT member_id FROM payments`);
      const mems = await tx.query(`SELECT member_id FROM memberships`);
      return { pays: pays.rows, mems: mems.rows } as {
        pays: { member_id: string }[];
        mems: { member_id: string }[];
      };
    });
    for (const row of [...res.pays, ...res.mems]) expect(row.member_id).toBe(fx.a.memberId);
  });

  it('member cannot write anything (no insert/update paths)', async () => {
    await expect(
      withClaims(appPool(), memberClaims(fx.a), (tx) =>
        tx.query(`UPDATE memberships SET end_date = end_date + 365 WHERE member_id = $1`, [
          fx.a.memberId,
        ]),
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
    await expect(
      withClaims(appPool(), memberClaims(fx.a), (tx) =>
        tx.query(
          `INSERT INTO payments (tenant_id, branch_id, member_id, amount, method)
           VALUES ($1, $2, $3, 1, 'cash')`,
          [fx.a.tenantId, fx.a.branchId, fx.a.memberId],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('member cannot read staff mobile numbers via trainers table', async () => {
    const rows = await withClaims(appPool(), memberClaims(fx.a), async (tx) => {
      const r = await tx.query(`SELECT * FROM trainers`);
      return r.rows;
    });
    expect(rows).toHaveLength(0); // members use trainer_public view only
  });
});

describe('unauthenticated and forged claims', () => {
  it('no claims → no rows anywhere', async () => {
    for (const table of ['members', 'payments', 'tenants', 'users']) {
      const rows = await withoutClaims(appPool(), async (tx) => {
        const r = await tx.query(`SELECT * FROM ${table}`);
        return r.rows;
      });
      expect(rows, `${table} visible without claims`).toHaveLength(0);
    }
  });

  it('member claiming kind=staff gains nothing (DB cross-checks user kind)', async () => {
    const rows = await withClaims(
      appPool(),
      { sub: fx.a.memberUserId, tenant_id: fx.a.tenantId, kind: 'staff' },
      async (tx) => {
        const r = await tx.query(`SELECT * FROM members`);
        return r.rows;
      },
    );
    expect(rows).toHaveLength(0);
  });

  it('staff claiming a different tenant_id gains nothing', async () => {
    const rows = await withClaims(
      appPool(),
      { sub: fx.a.ownerUserId, tenant_id: fx.b.tenantId, kind: 'staff' },
      async (tx) => {
        const r = await tx.query(`SELECT * FROM members`);
        return r.rows;
      },
    );
    // owner's user row belongs to tenant A, so is_active_staff() fails for tenant B claims
    expect(rows).toHaveLength(0);
  });

  it('platform admin claim requires a real platform_admin user row', async () => {
    const rows = await withClaims(
      appPool(),
      { sub: fx.a.ownerUserId, tenant_id: null, kind: 'platform_admin' },
      async (tx) => {
        const r = await tx.query(`SELECT * FROM tenants`);
        return r.rows;
      },
    );
    expect(rows).toHaveLength(0);
  });
});

describe('platform admin', () => {
  it('sees all tenants (platform operations)', async () => {
    const rows = await withClaims(appPool(), platformClaims(fx), async (tx) => {
      const r = await tx.query(`SELECT slug FROM tenants ORDER BY slug`);
      return r.rows as { slug: string }[];
    });
    expect(rows.map((r) => r.slug)).toEqual(['tenant-a', 'tenant-b']);
  });
});
