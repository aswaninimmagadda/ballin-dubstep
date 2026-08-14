/**
 * Concurrency safety: receipt numbering under parallel load, idempotent
 * payment/membership writes, single-live-membership invariant.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { setupOnce, appPool, withClaims, staffClaims, type Fixtures } from './helpers';

let fx: Fixtures;
beforeAll(async () => {
  fx = await setupOnce();
});

describe('receipt sequence allocation', () => {
  it('20 concurrent allocations produce 20 unique sequential numbers', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        withClaims(appPool(), staffClaims(fx.a, 'receptionist'), async (tx) => {
          const r = await tx.query(`SELECT app.next_receipt_seq($1, '2027') AS seq`, [
            fx.a.tenantId,
          ]);
          return Number(r.rows[0].seq);
        }),
      ),
    );
    const unique = new Set(results);
    expect(unique.size).toBe(20);
    expect(Math.min(...results)).toBe(1);
    expect(Math.max(...results)).toBe(20);
  });

  it('sequences are per-tenant — tenant B starts from 1 independently', async () => {
    const seq = await withClaims(appPool(), staffClaims(fx.b, 'receptionist'), async (tx) => {
      const r = await tx.query(`SELECT app.next_receipt_seq($1, '2027') AS seq`, [fx.b.tenantId]);
      return Number(r.rows[0].seq);
    });
    expect(seq).toBe(1);
  });
});

describe('idempotency', () => {
  it('repeated payment submission with the same idempotency key is rejected', async () => {
    const insert = (key: string) =>
      withClaims(appPool(), staffClaims(fx.a, 'receptionist'), (tx) =>
        tx.query(
          `INSERT INTO payments (tenant_id, branch_id, member_id, amount, method, idempotency_key)
           VALUES ($1, $2, $3, 100000, 'cash', $4)`,
          [fx.a.tenantId, fx.a.branchId, fx.a.memberId, key],
        ),
      );
    await insert('double-click-1');
    await expect(insert('double-click-1')).rejects.toThrow(/duplicate key/);
  });

  it('a member cannot hold two live memberships (double-sell guard)', async () => {
    // fixture member already has a live membership
    await expect(
      withClaims(appPool(), staffClaims(fx.a, 'receptionist'), (tx) =>
        tx.query(
          `INSERT INTO memberships
            (tenant_id, branch_id, member_id, plan_id, plan_version_id, plan_name_snapshot,
             start_date, base_end_date, end_date, state, total_amount)
           VALUES ($1, $2, $3, $4, $5, '3 Month', CURRENT_DATE, CURRENT_DATE + 90, CURRENT_DATE + 90, 'active', 250000)`,
          [fx.a.tenantId, fx.a.branchId, fx.a.memberId, fx.a.planId, fx.a.planVersionId],
        ),
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it('membership numbers allocate uniquely under concurrency', async () => {
    const nums = await Promise.all(
      Array.from({ length: 10 }, () =>
        withClaims(appPool(), staffClaims(fx.a, 'receptionist'), async (tx) => {
          const r = await tx.query(`SELECT app.next_membership_number($1) AS n`, [fx.a.tenantId]);
          return r.rows[0].n as string;
        }),
      ),
    );
    expect(new Set(nums).size).toBe(10);
  });
});
