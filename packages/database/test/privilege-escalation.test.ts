/**
 * Regression tests for the privilege-escalation paths found in the
 * pre-release security review. Each of these was reproducible against a
 * migrated database as the runtime role before migration 0015.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import pg from 'pg';
import {
  setupOnce,
  appPool,
  withClaims,
  staffClaims,
  memberClaims,
  OWNER_URL,
  type Fixtures,
} from './helpers';

let fx: Fixtures;
beforeAll(async () => {
  fx = await setupOnce();
});

describe('a user cannot rewrite their own privileges', () => {
  it('receptionist cannot promote themselves to platform_admin', async () => {
    await expect(
      withClaims(appPool(), staffClaims(fx.a, 'receptionist'), (tx) =>
        tx.query(`UPDATE users SET kind = 'platform_admin', tenant_id = NULL WHERE id = $1`, [
          fx.a.receptionistUserId,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('receptionist cannot move their own account to another tenant', async () => {
    await expect(
      withClaims(appPool(), staffClaims(fx.a, 'receptionist'), (tx) =>
        tx.query(`UPDATE users SET tenant_id = $2 WHERE id = $1`, [
          fx.a.receptionistUserId,
          fx.b.tenantId,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('a member cannot turn their login into a staff account', async () => {
    await expect(
      withClaims(appPool(), memberClaims(fx.a), (tx) =>
        tx.query(`UPDATE users SET kind = 'staff' WHERE id = $1`, [fx.a.memberUserId]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('a benign self-update still works', async () => {
    const n = await withClaims(appPool(), staffClaims(fx.a, 'receptionist'), async (tx) => {
      const r = await tx.query(`UPDATE users SET language = 'te' WHERE id = $1`, [
        fx.a.receptionistUserId,
      ]);
      return r.rowCount;
    });
    expect(n).toBe(1);
  });
});

describe('member app credential issuance cannot be aimed at a staff account', () => {
  it('members.user_id cannot be repointed at a non-member login', async () => {
    // This was step 1 of the takeover: members.edit lets the receptionist
    // write any column on a member row, including the link to a login.
    await expect(
      withClaims(appPool(), staffClaims(fx.a, 'receptionist'), (tx) =>
        tx.query(`UPDATE members SET user_id = $2 WHERE id = $1`, [
          fx.a.memberId,
          fx.a.ownerUserId,
        ]),
      ),
    ).rejects.toThrow(/member login in the same gym/);
  });

  it('a new member cannot be onboarded already linked to a staff login', async () => {
    // members.create is a reception permission, so guarding only UPDATE would
    // have left the same route open through onboarding.
    await expect(
      withClaims(appPool(), staffClaims(fx.a, 'receptionist'), (tx) =>
        tx.query(
          `INSERT INTO members (tenant_id, branch_id, membership_number, first_name, mobile, user_id)
           VALUES ($1, $2, 'M9001', 'Linked', '+919876500091', $3)`,
          [fx.a.tenantId, fx.a.branchId, fx.a.ownerUserId],
        ),
      ),
    ).rejects.toThrow(/member login in the same gym/);
  });

  it('app.member_app_enable refuses a member linked to a non-member login', async () => {
    // Belt and braces: even if the link were somehow set, the function that
    // writes the password hash must not take it on trust. Force the link past
    // the trigger as the table owner, then call the function as the app role.
    const owner = new pg.Client({ connectionString: OWNER_URL });
    await owner.connect();
    try {
      await owner.query(`ALTER TABLE members DISABLE TRIGGER members_guard_user_link`);
      const up = await owner.query(`UPDATE members SET user_id = $2 WHERE id = $1`, [
        fx.a.memberId,
        fx.a.ownerUserId,
      ]);
      expect(up.rowCount).toBe(1);
      await expect(
        withClaims(appPool(), staffClaims(fx.a, 'receptionist'), (tx) =>
          tx.query(`SELECT app.member_app_enable($1, $2)`, [fx.a.memberId, 'scrypt$1$1$1$aa$bb']),
        ),
      ).rejects.toThrow(/not linked to a member login/);
    } finally {
      await owner.query(`UPDATE members SET user_id = NULL WHERE id = $1`, [fx.a.memberId]);
      await owner.query(`ALTER TABLE members ENABLE TRIGGER members_guard_user_link`);
      await owner.end();
    }
  });
});

describe('tenant suspension reaches the member app', () => {
  it('a refresh token stops rotating once the gym is suspended', async () => {
    const owner = new pg.Client({ connectionString: OWNER_URL });
    await owner.connect();
    const hash = 'a'.repeat(64);
    try {
      await owner.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + interval '30 days')`,
        [fx.a.memberUserId, hash],
      );
      await owner.query(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, [fx.a.tenantId]);
      const row = await owner.query(`SELECT * FROM app.refresh_consume($1)`, [hash]);
      expect(row.rows[0]?.tenant_status).toBe('suspended');
    } finally {
      await owner.query(`UPDATE tenants SET status = 'active' WHERE id = $1`, [fx.a.tenantId]);
      await owner.query(`DELETE FROM refresh_tokens WHERE token_hash = $1`, [hash]);
      await owner.end();
    }
  });
});
