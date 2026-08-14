import pg from 'pg';
import { dropAll, runMigrations } from '../src/migrate.js';
import { createPool, withClaims, withoutClaims, type Claims } from '../src/client.js';
import { SYSTEM_ROLE_PERMISSIONS, hashPassword } from '@gymflow/core';

export const OWNER_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://gymflow:gymflow_dev_pw@localhost:5432/gymflow_test';
export const APP_URL =
  process.env.TEST_DATABASE_APP_URL ??
  'postgres://gymflow_app:gymflow_app_dev_pw@localhost:5432/gymflow_test';

export interface TenantFixture {
  tenantId: string;
  branchId: string;
  ownerUserId: string;
  receptionistUserId: string;
  accountantUserId: string;
  memberUserId: string;
  memberId: string;
  planId: string;
  planVersionId: string;
  membershipId: string;
  paymentId: string;
}

export interface Fixtures {
  a: TenantFixture;
  b: TenantFixture;
  platformAdminId: string;
}

let fixturesPromise: Promise<Fixtures> | null = null;
let appPoolInstance: pg.Pool | null = null;

export function appPool(): pg.Pool {
  if (!appPoolInstance) appPoolInstance = createPool(APP_URL, 10);
  return appPoolInstance;
}

export async function closePools(): Promise<void> {
  await appPoolInstance?.end();
  appPoolInstance = null;
}

export function staffClaims(f: TenantFixture, who: 'owner' | 'receptionist' | 'accountant'): Claims {
  const sub =
    who === 'owner' ? f.ownerUserId : who === 'receptionist' ? f.receptionistUserId : f.accountantUserId;
  return { sub, tenant_id: f.tenantId, kind: 'staff' };
}

export function memberClaims(f: TenantFixture): Claims {
  return { sub: f.memberUserId, tenant_id: f.tenantId, kind: 'member' };
}

export function platformClaims(fx: Fixtures): Claims {
  return { sub: fx.platformAdminId, tenant_id: null, kind: 'platform_admin' };
}

export { withClaims, withoutClaims };

/** Reset the test database and create two fully-populated tenants. */
export function setupOnce(): Promise<Fixtures> {
  if (!fixturesPromise) fixturesPromise = doSetup();
  return fixturesPromise;
}

async function doSetup(): Promise<Fixtures> {
  await dropAll(OWNER_URL);
  await runMigrations(OWNER_URL);
  const client = new pg.Client({ connectionString: OWNER_URL });
  await client.connect();
  const hash = await hashPassword('test-password-123');
  try {
    const platformAdmin = (
      await client.query(
        `INSERT INTO users (kind, tenant_id, email, display_name)
         VALUES ('platform_admin', NULL, 'platform@test.local', 'Platform') RETURNING id`,
      )
    ).rows[0].id as string;
    await client.query(`INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)`, [
      platformAdmin,
      hash,
    ]);

    const a = await makeTenant(client, 'tenant-a', 'Gym A (Test)', hash);
    const b = await makeTenant(client, 'tenant-b', 'Gym B (Test)', hash);
    return { a, b, platformAdminId: platformAdmin };
  } finally {
    await client.end();
  }
}

async function makeTenant(client: pg.Client, slug: string, name: string, hash: string): Promise<TenantFixture> {
  const t = (
    await client.query(
      `INSERT INTO tenants (slug, name, status) VALUES ($1, $2, 'active') RETURNING id`,
      [slug, name],
    )
  ).rows[0].id as string;
  const brand = (
    await client.query(`INSERT INTO brands (tenant_id, name) VALUES ($1, $2) RETURNING id`, [t, name])
  ).rows[0].id as string;
  const branch = (
    await client.query(
      `INSERT INTO branches (tenant_id, brand_id, name, code) VALUES ($1, $2, 'Main', 'MAIN') RETURNING id`,
      [t, brand],
    )
  ).rows[0].id as string;
  await client.query(`INSERT INTO gym_settings (tenant_id) VALUES ($1)`, [t]);

  const roleIds: Record<string, string> = {};
  for (const [key, perms] of Object.entries(SYSTEM_ROLE_PERMISSIONS)) {
    const r = (
      await client.query(
        `INSERT INTO roles (tenant_id, key, name, is_system) VALUES ($1, $2, $2, true) RETURNING id`,
        [t, key],
      )
    ).rows[0].id as string;
    roleIds[key] = r;
    for (const p of perms) {
      await client.query(`INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)`, [r, p]);
    }
  }

  async function mkStaff(email: string, roleKey: string): Promise<string> {
    const u = (
      await client.query(
        `INSERT INTO users (kind, tenant_id, email, display_name) VALUES ('staff', $1, $2, $2) RETURNING id`,
        [t, `${email}@${slug}.test.local`],
      )
    ).rows[0].id as string;
    await client.query(`INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)`, [u, hash]);
    await client.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [u, roleIds[roleKey]]);
    return u;
  }
  const owner = await mkStaff('owner', 'owner');
  const receptionist = await mkStaff('reception', 'receptionist');
  const accountant = await mkStaff('accounts', 'accountant');

  const memberUser = (
    await client.query(
      `INSERT INTO users (kind, tenant_id, phone, display_name)
       VALUES ('member', $1, '+919876500001', 'Member One') RETURNING id`,
      [t],
    )
  ).rows[0].id as string;
  await client.query(`INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)`, [
    memberUser,
    hash,
  ]);

  const member = (
    await client.query(
      `INSERT INTO members (tenant_id, branch_id, user_id, membership_number, first_name, mobile, status)
       VALUES ($1, $2, $3, 'M1001', 'Member', '+919876500001', 'active') RETURNING id`,
      [t, branch, memberUser],
    )
  ).rows[0].id as string;

  const plan = (
    await client.query(
      `INSERT INTO membership_plans (tenant_id, name) VALUES ($1, '3 Month') RETURNING id`,
      [t],
    )
  ).rows[0].id as string;
  const planVersion = (
    await client.query(
      `INSERT INTO membership_plan_versions
        (tenant_id, plan_id, version, duration_unit, duration_value, base_price, joining_fee)
       VALUES ($1, $2, 1, 'months', 3, 250000, 50000) RETURNING id`,
      [t, plan],
    )
  ).rows[0].id as string;

  const membership = (
    await client.query(
      `INSERT INTO memberships
        (tenant_id, branch_id, member_id, plan_id, plan_version_id, plan_name_snapshot,
         start_date, base_end_date, end_date, state, total_amount)
       VALUES ($1, $2, $3, $4, $5, '3 Month', CURRENT_DATE - 10, CURRENT_DATE + 80, CURRENT_DATE + 80, 'active', 300000)
       RETURNING id`,
      [t, branch, member, plan, planVersion],
    )
  ).rows[0].id as string;

  const payment = (
    await client.query(
      `INSERT INTO payments (tenant_id, branch_id, member_id, amount, method, received_by)
       VALUES ($1, $2, $3, 300000, 'cash', $4) RETURNING id`,
      [t, branch, member, receptionist],
    )
  ).rows[0].id as string;
  await client.query(
    `INSERT INTO receipts (tenant_id, branch_id, payment_id, receipt_number, sequence, fiscal_year)
     VALUES ($1, $2, $3, $4, 1, '2026')`,
    [t, branch, payment, `${slug.toUpperCase()}-2026-000001`],
  );

  return {
    tenantId: t,
    branchId: branch,
    ownerUserId: owner,
    receptionistUserId: receptionist,
    accountantUserId: accountant,
    memberUserId: memberUser,
    memberId: member,
    planId: plan,
    planVersionId: planVersion,
    membershipId: membership,
    paymentId: payment,
  };
}
