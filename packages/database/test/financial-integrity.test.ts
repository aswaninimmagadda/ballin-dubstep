/**
 * Financial records are append-only. Even an owner with every permission
 * cannot rewrite or delete payment history — the database forbids it.
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
beforeAll(async () => {
  fx = await setupOnce();
});

describe('payments immutability', () => {
  it('amount can never be edited', async () => {
    await expect(
      withClaims(appPool(), staffClaims(fx.a, 'owner'), (tx) =>
        tx.query(`UPDATE payments SET amount = 1 WHERE id = $1`, [fx.a.paymentId]),
      ),
    ).rejects.toThrow(/immutable/);
  });

  it('payments cannot be deleted', async () => {
    await expect(
      withClaims(appPool(), staffClaims(fx.a, 'owner'), (tx) =>
        tx.query(`DELETE FROM payments WHERE id = $1`, [fx.a.paymentId]),
      ),
    ).rejects.toThrow(/(append-only|no permitido|denied|permission)/i);
  });

  it('status may transition to refunded (the one allowed mutation)', async () => {
    const n = await withClaims(appPool(), staffClaims(fx.a, 'accountant'), async (tx) => {
      const r = await tx.query(`UPDATE payments SET status = 'partially_refunded' WHERE id = $1`, [
        fx.a.paymentId,
      ]);
      return r.rowCount;
    });
    expect(n).toBe(1);
  });

  it('receipts are immutable: staff have no update path, and even the platform trigger blocks', async () => {
    // Staff: RLS provides no UPDATE policy for receipts — zero rows reachable.
    const n = await withClaims(appPool(), staffClaims(fx.a, 'owner'), async (tx) => {
      const r = await tx.query(
        `UPDATE receipts SET receipt_number = 'FAKE-1' WHERE payment_id = $1`,
        [fx.a.paymentId],
      );
      return r.rowCount;
    });
    expect(n).toBe(0);
    // Platform admin: rows are reachable, but the append-only trigger fires.
    await expect(
      withClaims(appPool(), platformClaims(fx), (tx) =>
        tx.query(`UPDATE receipts SET receipt_number = 'FAKE-1' WHERE payment_id = $1`, [
          fx.a.paymentId,
        ]),
      ),
    ).rejects.toThrow(/append-only/);
  });

  it('audit logs cannot be erased by tenant staff', async () => {
    await withClaims(appPool(), staffClaims(fx.a, 'owner'), (tx) =>
      tx.query(
        `INSERT INTO audit_logs (tenant_id, actor_id, actor_label, action, entity_type, entity_id)
         VALUES ($1, $2, 'Owner', 'member.edit', 'member', $3)`,
        [fx.a.tenantId, fx.a.ownerUserId, fx.a.memberId],
      ),
    );
    await expect(
      withClaims(appPool(), staffClaims(fx.a, 'owner'), (tx) =>
        tx.query(`DELETE FROM audit_logs WHERE tenant_id = $1`, [fx.a.tenantId]),
      ),
    ).rejects.toThrow(/(append-only|denied|permission)/i);
  });
});
