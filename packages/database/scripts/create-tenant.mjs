#!/usr/bin/env node
/**
 * Platform-operator CLI: provision a new gym tenant end to end — tenant,
 * brand, branch, settings, system roles + permissions, and the first owner
 * account. After this, EVERYTHING else (plans, staff, trainers, promotions,
 * templates, branding) is configured by the gym owner in the admin UI — no
 * source-code changes per gym, which is the commercialization acceptance
 * criterion.
 *
 * Usage:
 *   DATABASE_URL=postgres://owner@host/db node scripts/create-tenant.mjs \
 *     --slug harshagym --name "Harsha Gym" --owner-email owner@harshagym.in \
 *     [--branch "Main/MAIN"] [--receipt-prefix HGM] [--owner-name "Owner"] \
 *     [--owner-password '...']   # omit to auto-generate (printed once)
 *
 * Runs as the database owner (platform operation). Idempotency: refuses to
 * run if the slug already exists.
 */
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { hashPassword, SYSTEM_ROLE_PERMISSIONS } from '@gymflow/core';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1];
}

const url = process.env.DATABASE_URL;
const slug = arg('slug');
const name = arg('name');
const ownerEmail = arg('owner-email');
const branchSpec = arg('branch', 'Main/MAIN');
const receiptPrefix = (arg('receipt-prefix', 'GYM') ?? 'GYM').toUpperCase();
const ownerName = arg('owner-name', 'Owner');
const ownerPassword = arg('owner-password') ?? randomBytes(9).toString('base64url');

if (!url || !slug || !name || !ownerEmail) {
  console.error(
    'Usage: DATABASE_URL=… node scripts/create-tenant.mjs --slug <slug> --name "<Gym Name>" --owner-email <email> [--branch "Name/CODE"] [--receipt-prefix XXX]',
  );
  process.exit(1);
}
const [branchName = 'Main', branchCode = 'MAIN'] = String(branchSpec).split('/');

const client = new pg.Client({ connectionString: url });

async function main() {
  await client.connect();
  const exists = await client.query(`SELECT 1 FROM tenants WHERE slug = $1`, [slug]);
  if (exists.rowCount) {
    console.error(`Tenant "${slug}" already exists — nothing done.`);
    process.exitCode = 1;
    return;
  }
  const hash = await hashPassword(ownerPassword);

  await client.query('BEGIN');
  const tenant = (
    await client.query(
      `INSERT INTO tenants (slug, name, status) VALUES ($1, $2, 'active') RETURNING id`,
      [slug, name],
    )
  ).rows[0].id;
  const brand = (
    await client.query(`INSERT INTO brands (tenant_id, name) VALUES ($1, $2) RETURNING id`, [
      tenant,
      name,
    ])
  ).rows[0].id;
  await client.query(
    `INSERT INTO branches (tenant_id, brand_id, name, code) VALUES ($1, $2, $3, upper($4))`,
    [tenant, brand, branchName, branchCode],
  );
  await client.query(`INSERT INTO gym_settings (tenant_id, receipt_prefix) VALUES ($1, $2)`, [
    tenant,
    receiptPrefix,
  ]);
  for (const key of ['attendance', 'pt', 'leads']) {
    await client.query(
      `INSERT INTO feature_flags (tenant_id, key, enabled) VALUES ($1, $2, true)`,
      [tenant, key],
    );
  }

  const roleIds = {};
  for (const [key, perms] of Object.entries(SYSTEM_ROLE_PERMISSIONS)) {
    const role = (
      await client.query(
        `INSERT INTO roles (tenant_id, key, name, is_system)
         VALUES ($1, $2, initcap(replace($2, '_', ' ')), true) RETURNING id`,
        [tenant, key],
      )
    ).rows[0].id;
    roleIds[key] = role;
    for (const p of perms) {
      await client.query(`INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)`, [
        role,
        p,
      ]);
    }
  }
  await client.query(
    `INSERT INTO roles (tenant_id, key, name, is_system) VALUES ($1, 'member', 'Member', true)`,
    [tenant],
  );

  const owner = (
    await client.query(
      `INSERT INTO users (kind, tenant_id, email, display_name)
       VALUES ('staff', $1, lower($2), $3) RETURNING id`,
      [tenant, ownerEmail, ownerName],
    )
  ).rows[0].id;
  // must_change: the owner's password is printed to a terminal and handed over
  // by whoever provisioned the gym. It has to be replaced on first sign-in.
  await client.query(
    `INSERT INTO user_credentials (user_id, password_hash, must_change) VALUES ($1, $2, true)`,
    [owner, hash],
  );
  await client.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [
    owner,
    roleIds.owner,
  ]);
  await client.query(
    `INSERT INTO audit_logs (tenant_id, actor_label, action, entity_type, entity_id, after)
     VALUES ($1, 'platform operator', 'tenant.create', 'tenant', $1, $2)`,
    [tenant, JSON.stringify({ slug, name, branch: `${branchName}/${branchCode}` })],
  );
  await client.query('COMMIT');

  console.log(`Tenant created: ${name} (${slug})`);
  console.log(`  Branch: ${branchName} (${branchCode}) · Receipt prefix: ${receiptPrefix}`);
  console.log(`  Owner login: ${ownerEmail}`);
  console.log(`  One-time owner password (share securely, shown once): ${ownerPassword}`);
  console.log('  The owner must choose their own password on first sign-in.');
  console.log('  Next: owner signs in and configures plans, staff, trainers, promotions.');
}

main()
  .catch(async (err) => {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* not in tx */
    }
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => client.end());
