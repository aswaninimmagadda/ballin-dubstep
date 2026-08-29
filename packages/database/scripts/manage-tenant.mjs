#!/usr/bin/env node
/**
 * Platform-operator CLI for a gym's life after provisioning.
 *
 * create-tenant.mjs could bring a gym into existence and nothing could do
 * anything to it afterwards: no way to suspend a customer who stopped paying,
 * no way to hand back their data, and no way to remove a tenant created by
 * mistake — the last of which is not merely missing but impossible by design,
 * because create-tenant writes a `tenant.create` row into the append-only
 * audit log and audit_logs.tenant_id is a foreign key. Attempting the delete
 * fails on that constraint, and deleting the audit row fails on the
 * append-only trigger. That is the correct trade-off (financial history
 * outranks tidiness), but it has to be a stated one with an alternative.
 *
 * The alternative is `status`, which the schema has always had and nothing
 * ever set:
 *
 *   trial | active     — normal operation
 *   suspended          — nobody can sign in: staff sessions are refused, member
 *                        logins are refused, and refresh tokens stop rotating.
 *                        Reversible. This is the commercial lever.
 *   archived           — the same lockout, meant as permanent. The data stays
 *                        for the statutory retention period.
 *
 * Usage:
 *   DATABASE_URL=… node scripts/manage-tenant.mjs list
 *   DATABASE_URL=… node scripts/manage-tenant.mjs suspend   --slug harshagym --reason "unpaid Q3"
 *   DATABASE_URL=… node scripts/manage-tenant.mjs reactivate --slug harshagym
 *   DATABASE_URL=… node scripts/manage-tenant.mjs archive   --slug harshagym --reason "closed"
 *   DATABASE_URL=… node scripts/manage-tenant.mjs export    --slug harshagym --out ./harshagym
 */
import pg from 'pg';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { toCsv } from '@gymflow/utils';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

// `pnpm run manage-tenant -- list` passes a bare `--` through as an argument,
// so take the first thing that is neither that nor a flag.
const command = process.argv.slice(2).find((a) => a !== '--' && !a.startsWith('--'));
const url = process.env.DATABASE_URL;
const slug = arg('slug');
const reason = arg('reason', '');
const outDir = arg('out');

const COMMANDS = ['list', 'suspend', 'reactivate', 'archive', 'export'];
if (!url || !COMMANDS.includes(command)) {
  console.error(
    `Usage: DATABASE_URL=… node scripts/manage-tenant.mjs <${COMMANDS.join('|')}> [--slug <slug>] [--reason "…"] [--out <dir>]`,
  );
  process.exit(1);
}
if (command !== 'list' && !slug) {
  console.error(`--slug is required for ${command}`);
  process.exit(1);
}

const db = new pg.Client({ connectionString: url });
await db.connect();

async function tenantOrExit() {
  const { rows } = await db.query(`SELECT id, slug, name, status FROM tenants WHERE slug = $1`, [
    slug,
  ]);
  if (!rows.length) {
    console.error(`No gym with slug "${slug}". Run \`list\` to see what exists.`);
    process.exit(1);
  }
  return rows[0];
}

/** Status change + audit row + immediate lockout of everyone signed in. */
async function setStatus(tenant, status, action) {
  await db.query('BEGIN');
  await db.query(`UPDATE tenants SET status = $2, updated_at = now() WHERE id = $1`, [
    tenant.id,
    status,
  ]);
  if (status !== 'active' && status !== 'trial') {
    // Session checks already refuse a suspended gym on the next request, but
    // revoking makes it true immediately rather than at the next page load,
    // and drops the long-lived member refresh tokens.
    await db.query(
      `UPDATE sessions SET revoked_at = now()
        WHERE revoked_at IS NULL
          AND user_id IN (SELECT id FROM users WHERE tenant_id = $1)`,
      [tenant.id],
    );
    await db.query(
      `UPDATE refresh_tokens SET revoked_at = now()
        WHERE revoked_at IS NULL
          AND user_id IN (SELECT id FROM users WHERE tenant_id = $1)`,
      [tenant.id],
    );
  }
  await db.query(
    `INSERT INTO audit_logs (tenant_id, actor_id, actor_label, action, entity_type, entity_id, before, after)
     VALUES ($1, NULL, 'platform operator (CLI)', $2, 'tenant', $1, $3, $4)`,
    [
      tenant.id,
      action,
      JSON.stringify({ status: tenant.status }),
      JSON.stringify({ status, reason: reason || null }),
    ],
  );
  await db.query('COMMIT');
}

try {
  if (command === 'list') {
    const { rows } = await db.query(
      `SELECT t.slug, t.name, t.status, t.created_at::date::text AS since,
              (SELECT count(*) FROM members m WHERE m.tenant_id = t.id AND m.archived_at IS NULL)::int AS members,
              (SELECT count(*) FROM memberships ms WHERE ms.tenant_id = t.id AND ms.state = 'active')::int AS active
         FROM tenants t ORDER BY t.created_at`,
    );
    if (!rows.length) {
      console.log('No gyms provisioned.');
    } else {
      console.log(
        `${'SLUG'.padEnd(22)}${'STATUS'.padEnd(11)}${'MEMBERS'.padStart(8)}${'ACTIVE'.padStart(8)}  SINCE       NAME`,
      );
      for (const r of rows) {
        console.log(
          `${r.slug.padEnd(22)}${r.status.padEnd(11)}${String(r.members).padStart(8)}${String(
            r.active,
          ).padStart(8)}  ${String(r.since).slice(0, 10)}  ${r.name}`,
        );
      }
    }
  }

  if (command === 'suspend' || command === 'archive' || command === 'reactivate') {
    const tenant = await tenantOrExit();
    const status =
      command === 'reactivate' ? 'active' : command === 'suspend' ? 'suspended' : 'archived';
    if (tenant.status === status) {
      console.log(`"${tenant.slug}" is already ${status}. Nothing to do.`);
    } else {
      await setStatus(tenant, status, `tenant.${command}`);
      console.log(`"${tenant.slug}" (${tenant.name}): ${tenant.status} → ${status}`);
      if (status === 'active') {
        console.log('Staff and members can sign in again. They will need to log in fresh.');
      } else {
        console.log('Every staff session and member refresh token for this gym is revoked.');
        console.log('Their data is retained; reactivate to restore access.');
      }
    }
  }

  if (command === 'export') {
    // Offboarding: the gym's own data, in a form they can open, before their
    // access is taken away. Not having this made "suspend" indistinguishable
    // from confiscation.
    const tenant = await tenantOrExit();
    const dir = outDir ?? `./${tenant.slug}-export`;
    mkdirSync(dir, { recursive: true });
    const tables = {
      members: `SELECT membership_number, first_name, last_name, mobile, alt_mobile, email,
                       gender, date_of_birth::text AS date_of_birth, address_line1, village, district, state, pin_code,
                       emergency_contact_name, emergency_contact_phone, join_date::text AS join_date, status,
                       notes, archived_at::text AS archived_at
                  FROM members WHERE tenant_id = $1 ORDER BY membership_number`,
      memberships: `SELECT m.membership_number, ms.plan_name_snapshot, ms.start_date::text AS start_date, ms.end_date::text AS end_date,
                           ms.state, ms.total_amount, ms.discount_amount, ms.tax_amount
                      FROM memberships ms JOIN members m ON m.id = ms.member_id
                     WHERE ms.tenant_id = $1 ORDER BY ms.created_at`,
      payments: `SELECT r.receipt_number, m.membership_number, p.amount, p.method, p.status,
                        p.payment_date::text AS payment_date, p.external_reference
                   FROM payments p
                   JOIN members m ON m.id = p.member_id
                   LEFT JOIN receipts r ON r.payment_id = p.id
                  WHERE p.tenant_id = $1 ORDER BY p.payment_date`,
      refunds: `SELECT r.amount, r.reason, r.created_at::text AS created_at,
                       p.payment_date::text AS original_payment_date
                  FROM refunds r JOIN payments p ON p.id = r.payment_id
                 WHERE r.tenant_id = $1 ORDER BY r.created_at`,
      attendance: `SELECT m.membership_number, a.checked_in_at::text AS checked_in_at, a.method
                     FROM attendance a JOIN members m ON m.id = a.member_id
                    WHERE a.tenant_id = $1 ORDER BY a.checked_in_at`,
      plans: `SELECT p.name, v.version, v.duration_unit, v.duration_value, v.base_price,
                     v.joining_fee, v.tax_rate_bps, v.tax_inclusive, p.is_active
                FROM membership_plans p
                JOIN membership_plan_versions v ON v.plan_id = p.id
               WHERE p.tenant_id = $1 ORDER BY p.name, v.version`,
    };
    // Every date is cast to text in the queries above: this script talks to
    // postgres directly rather than through packages/database's client, which
    // is where the DATE type parser lives, so an uncast column would arrive as
    // a JS Date and be written as "Sat Aug 29 2026 00:00:00 GMT+0000" into a
    // file the gym is meant to be able to open.
    for (const [name, sql] of Object.entries(tables)) {
      const { rows } = await db.query(sql, [tenant.id]);
      // BOM so Telugu names open correctly in Excel, same as the app's exports.
      writeFileSync(join(dir, `${name}.csv`), `﻿${toCsv(rows)}`, 'utf8');
      console.log(`  ${name.padEnd(12)} ${String(rows.length).padStart(7)} rows`);
    }
    console.log(`\nExported "${tenant.slug}" to ${dir}`);
  }
} catch (err) {
  await db.query('ROLLBACK').catch(() => {});
  console.error(err.message ?? err);
  process.exitCode = 1;
} finally {
  await db.end();
}
