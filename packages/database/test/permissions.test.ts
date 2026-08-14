/**
 * Granular permission enforcement at the database layer: role permissions
 * gate writes even for correctly-tenanted staff.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { setupOnce, appPool, withClaims, staffClaims, type Fixtures } from './helpers';

let fx: Fixtures;
beforeAll(async () => {
  fx = await setupOnce();
});

describe('permission gates', () => {
  it('receptionist can create members', async () => {
    const inserted = await withClaims(appPool(), staffClaims(fx.a, 'receptionist'), async (tx) => {
      const r = await tx.query(
        `INSERT INTO members (tenant_id, branch_id, membership_number, first_name, mobile)
         VALUES ($1, $2, 'M2001', 'FromReception', '+919876500002') RETURNING id`,
        [fx.a.tenantId, fx.a.branchId],
      );
      return r.rowCount;
    });
    expect(inserted).toBe(1);
  });

  it('receptionist cannot record refunds (payments.refund missing)', async () => {
    await expect(
      withClaims(appPool(), staffClaims(fx.a, 'receptionist'), (tx) =>
        tx.query(
          `INSERT INTO refunds (tenant_id, payment_id, amount, reason, approved_by, processed_by)
           VALUES ($1, $2, 1000, 'test refund', $3, $3)`,
          [fx.a.tenantId, fx.a.paymentId, fx.a.receptionistUserId],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('accountant CAN record refunds (payments.refund granted)', async () => {
    const n = await withClaims(appPool(), staffClaims(fx.a, 'accountant'), async (tx) => {
      const r = await tx.query(
        `INSERT INTO refunds (tenant_id, payment_id, amount, reason, approved_by, processed_by)
         VALUES ($1, $2, 1000, 'partial goodwill refund', $3, $3)`,
        [fx.a.tenantId, fx.a.paymentId, fx.a.accountantUserId],
      );
      return r.rowCount;
    });
    expect(n).toBe(1);
  });

  it('receptionist cannot change gym settings (settings.manage missing)', async () => {
    const n = await withClaims(appPool(), staffClaims(fx.a, 'receptionist'), async (tx) => {
      const r = await tx.query(
        `UPDATE gym_settings SET receipt_prefix = 'ZZZ' WHERE tenant_id = $1`,
        [fx.a.tenantId],
      );
      return r.rowCount;
    });
    expect(n).toBe(0);
  });

  it('owner can change gym settings', async () => {
    const n = await withClaims(appPool(), staffClaims(fx.a, 'owner'), async (tx) => {
      const r = await tx.query(
        `UPDATE gym_settings SET receipt_prefix = 'GYA' WHERE tenant_id = $1`,
        [fx.a.tenantId],
      );
      return r.rowCount;
    });
    expect(n).toBe(1);
  });

  it('accountant cannot create members (members.create missing)', async () => {
    await expect(
      withClaims(appPool(), staffClaims(fx.a, 'accountant'), (tx) =>
        tx.query(
          `INSERT INTO members (tenant_id, branch_id, membership_number, first_name, mobile)
           VALUES ($1, $2, 'M2002', 'NoPerm', '+919876500003')`,
          [fx.a.tenantId, fx.a.branchId],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('deactivated staff loses all access immediately', async () => {
    // Deactivate receptionist as owner, then try to read members as them.
    await withClaims(appPool(), staffClaims(fx.a, 'owner'), (tx) =>
      tx.query(`UPDATE users SET is_active = false WHERE id = $1`, [fx.a.receptionistUserId]),
    );
    const rows = await withClaims(appPool(), staffClaims(fx.a, 'receptionist'), async (tx) => {
      const r = await tx.query(`SELECT * FROM members`);
      return r.rows;
    });
    expect(rows).toHaveLength(0);
    // reactivate for later tests
    await withClaims(appPool(), staffClaims(fx.a, 'owner'), (tx) =>
      tx.query(`UPDATE users SET is_active = true WHERE id = $1`, [fx.a.receptionistUserId]),
    );
  });
});
