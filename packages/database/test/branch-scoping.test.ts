/**
 * Branch-level access (staff_branch_access) is enforced by RLS: staff with
 * explicit branch rows see only those branches; staff with no rows keep
 * whole-tenant access (the default for small gyms).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  setupOnce,
  appPool,
  withClaims,
  staffClaims,
  platformClaims,
  type Fixtures,
} from './helpers';

let fx: Fixtures;
let branch2: string;
let memberInBranch2: string;

beforeAll(async () => {
  fx = await setupOnce();
  // Platform admin provisions a second branch + a member in it for tenant A,
  // then restricts the receptionist to branch 1 only.
  await withClaims(appPool(), platformClaims(fx), async (tx) => {
    const brand = await tx.query(`SELECT id FROM brands WHERE tenant_id = $1 LIMIT 1`, [
      fx.a.tenantId,
    ]);
    const b = await tx.query(
      `INSERT INTO branches (tenant_id, brand_id, name, code) VALUES ($1, $2, 'Second', 'SEC')
       RETURNING id`,
      [fx.a.tenantId, (brand.rows[0] as { id: string }).id],
    );
    branch2 = (b.rows[0] as { id: string }).id;
    const m = await tx.query(
      `INSERT INTO members (tenant_id, branch_id, membership_number, first_name, mobile)
       VALUES ($1, $2, 'M9001', 'BranchTwo', '+919876500042') RETURNING id`,
      [fx.a.tenantId, branch2],
    );
    memberInBranch2 = (m.rows[0] as { id: string }).id;
    await tx.query(`INSERT INTO staff_branch_access (user_id, branch_id) VALUES ($1, $2)`, [
      fx.a.receptionistUserId,
      fx.a.branchId, // branch 1 only
    ]);
  });
});

describe('staff_branch_access enforcement', () => {
  it('branch-restricted receptionist cannot see the other branch member', async () => {
    const rows = await withClaims(appPool(), staffClaims(fx.a, 'receptionist'), async (tx) => {
      const r = await tx.query(`SELECT id, branch_id FROM members`);
      return r.rows as { id: string; branch_id: string }[];
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.branch_id).toBe(fx.a.branchId);
    expect(rows.map((r) => r.id)).not.toContain(memberInBranch2);
  });

  it('branch-restricted receptionist cannot INSERT into the other branch', async () => {
    await expect(
      withClaims(appPool(), staffClaims(fx.a, 'receptionist'), (tx) =>
        tx.query(
          `INSERT INTO members (tenant_id, branch_id, membership_number, first_name, mobile)
           VALUES ($1, $2, 'M9002', 'Sneak', '+919876500043')`,
          [fx.a.tenantId, branch2],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('owner without branch rows keeps whole-tenant access', async () => {
    const rows = await withClaims(appPool(), staffClaims(fx.a, 'owner'), async (tx) => {
      const r = await tx.query(`SELECT id FROM members WHERE id = $1`, [memberInBranch2]);
      return r.rows;
    });
    expect(rows).toHaveLength(1);
  });

  it('restriction applies to payments/attendance tables too', async () => {
    await withClaims(appPool(), platformClaims(fx), (tx) =>
      tx.query(
        `INSERT INTO payments (tenant_id, branch_id, member_id, amount, method)
         VALUES ($1, $2, $3, 50000, 'cash')`,
        [fx.a.tenantId, branch2, memberInBranch2],
      ),
    );
    const pays = await withClaims(appPool(), staffClaims(fx.a, 'receptionist'), async (tx) => {
      const r = await tx.query(`SELECT branch_id FROM payments`);
      return r.rows as { branch_id: string }[];
    });
    for (const p of pays) expect(p.branch_id).toBe(fx.a.branchId);
  });
});
