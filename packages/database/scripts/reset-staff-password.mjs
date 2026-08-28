#!/usr/bin/env node
/**
 * Platform-operator CLI: reset a staff password and sign that account out
 * everywhere. This is the support path for a gym whose owner is locked out.
 *
 * Why a CLI and not a screen: the admin UI's staff list is tenant-scoped, so
 * a platform admin sees no staff at all, and the alternative — a web page
 * that can reset any owner's password in any gym — would make one browser
 * session the master key to every tenant on the platform. A CLI keeps the
 * capability behind database-owner credentials, which are already the highest
 * privilege in the system, and every use is recorded in the tenant's audit
 * log.
 *
 * Usage:
 *   DATABASE_URL=postgres://owner@host/db node scripts/reset-staff-password.mjs \
 *     --email owner@harshagym.in [--password '...']   # omit to generate
 *
 *   # to find the account first:
 *   DATABASE_URL=… node scripts/reset-staff-password.mjs --list --gym harshagym
 */
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '@gymflow/core';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1];
}
const has = (name) => process.argv.includes(`--${name}`);

const url = process.env.DATABASE_URL;
const email = arg('email');
const gym = arg('gym');
const listOnly = has('list');
const password = arg('password') ?? randomBytes(9).toString('base64url');

if (!url || (!listOnly && !email)) {
  console.error(
    'Usage: DATABASE_URL=… node scripts/reset-staff-password.mjs --email <email> [--password …]\n' +
      '       DATABASE_URL=… node scripts/reset-staff-password.mjs --list [--gym <slug>]',
  );
  process.exit(1);
}

const db = new pg.Client({ connectionString: url });
await db.connect();

try {
  if (listOnly) {
    const { rows } = await db.query(
      `SELECT t.slug AS gym, u.email, u.display_name, u.is_active,
              coalesce(string_agg(r.key, ','), '—') AS roles
         FROM users u
         JOIN tenants t ON t.id = u.tenant_id
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
        WHERE u.kind = 'staff' AND ($1::text IS NULL OR t.slug = $1)
        GROUP BY t.slug, u.email, u.display_name, u.is_active
        ORDER BY t.slug, u.email`,
      [gym ?? null],
    );
    if (!rows.length) {
      console.error(gym ? `No staff accounts in gym "${gym}".` : 'No staff accounts.');
      process.exit(1);
    }
    for (const r of rows) {
      console.log(
        `${r.gym.padEnd(20)} ${r.email.padEnd(34)} ${r.roles.padEnd(14)} ${
          r.is_active ? 'active' : 'INACTIVE'
        }  ${r.display_name}`,
      );
    }
    process.exit(0);
  }

  const { rows } = await db.query(
    `SELECT u.id, u.display_name, u.is_active, t.slug AS gym, t.status AS tenant_status
       FROM users u JOIN tenants t ON t.id = u.tenant_id
      WHERE u.kind = 'staff' AND lower(u.email) = lower($1)`,
    [email],
  );
  if (!rows.length) {
    console.error(`No staff account with email "${email}". Try --list to see what exists.`);
    process.exit(1);
  }
  if (rows.length > 1) {
    // users_email_unique makes this impossible for staff, but fail loudly
    // rather than reset an account the operator did not mean.
    console.error(`"${email}" matches ${rows.length} accounts; refusing to guess.`);
    process.exit(1);
  }
  const target = rows[0];

  await db.query('BEGIN');
  const hash = await hashPassword(password);
  await db.query(
    `INSERT INTO user_credentials (user_id, password_hash, must_change)
     VALUES ($1, $2, true)
     ON CONFLICT (user_id)
     DO UPDATE SET password_hash = excluded.password_hash, must_change = true, updated_at = now()`,
    [target.id, hash],
  );
  // Any session opened with the old password is no longer the owner's to keep.
  await db.query(
    `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
    [target.id],
  );
  await db.query(
    `INSERT INTO audit_logs (tenant_id, actor_id, actor_label, action, entity_type, entity_id, after)
     SELECT u.tenant_id, NULL, 'platform operator (CLI)', 'staff.password_reset', 'user', u.id,
            jsonb_build_object('reason', 'operator-initiated recovery')
       FROM users u WHERE u.id = $1`,
    [target.id],
  );
  await db.query('COMMIT');

  console.log(`\nPassword reset for ${email} (${target.display_name}) in gym "${target.gym}".`);
  if (!target.is_active) console.log('NOTE: this account is deactivated and still cannot sign in.');
  if (target.tenant_status !== 'active' && target.tenant_status !== 'trial') {
    console.log(`NOTE: gym status is "${target.tenant_status}" — staff sign-in is blocked.`);
  }
  console.log('\nOne-time password — share it over a channel you trust, it is not stored:\n');
  console.log(`    ${password}\n`);
  console.log('All of their existing sessions have been signed out.');
} catch (err) {
  await db.query('ROLLBACK').catch(() => {});
  console.error(err.message ?? err);
  process.exitCode = 1;
} finally {
  await db.end();
}
