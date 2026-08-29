#!/usr/bin/env node
/**
 * Performance probe: builds a throwaway 5,000-member tenant and measures the
 * queries that dominate the admin app's hot paths, with RLS applied exactly as
 * the runtime role sees it.
 *
 * The point is that RLS predicates are the cost, not the scans: every policy
 * helper (app.is_active_staff(), app.has_permission(), ...) is a SECURITY
 * DEFINER function running an EXISTS, and PostgreSQL evaluates it once per
 * row unless the call is hoisted into a scalar subquery (migration 0014).
 *
 * The whole run happens inside ONE transaction that is always rolled back, and
 * the measurements run under SET LOCAL ROLE gymflow_app so the policies apply.
 * That matters for more than tidiness: payments and payment_allocations are
 * append-only (app.forbid_mutation), so a fixture built this way could not be
 * deleted afterwards without disabling the very trigger that protects the
 * gym's financial history. Rolling back never touches it.
 *
 * Usage:
 *   DATABASE_URL=postgres://postgres:...@host/db node scripts/perf-probe.mjs
 *
 * DATABASE_URL must own the tables and be able to SET ROLE gymflow_app
 * (superuser, or a member of that role).
 */
import pg from 'pg';

const ADMIN_URL = process.env.DATABASE_URL;
const APP_ROLE = process.env.DATABASE_APP_ROLE ?? 'gymflow_app';
const SLUG = 'perfprobe';
const N = Number(process.env.PERF_MEMBERS ?? 5000);
const BUDGET_MS = Number(process.env.PERF_BUDGET_MS ?? 250);
// Check-ins per member. 468 x 5,000 = ~2.3M attendance rows, i.e. three years
// of a busy gym — the scale the customer asked about.
const VISITS_PER_MEMBER = Number(process.env.PERF_VISITS ?? 468);

if (!ADMIN_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const DUE = `(ms.total_amount - coalesce((
  SELECT sum(GREATEST(pa.amount - coalesce((
    SELECT sum(rf.amount) FROM refunds rf WHERE rf.payment_id = pa.payment_id
  ), 0), 0))
  FROM payment_allocations pa WHERE pa.membership_id = ms.id), 0))`;

async function buildFixture(admin) {
  const { rows: t } = await admin.query(
    `INSERT INTO tenants (slug, name, status) VALUES ($1,'Perf Probe Gym','active') RETURNING id`,
    [SLUG],
  );
  const tenant = t[0].id;
  const { rows: br } = await admin.query(
    `WITH b AS (INSERT INTO brands (tenant_id, name) VALUES ($1,'Perf Brand') RETURNING id)
     INSERT INTO branches (tenant_id, brand_id, name, code, timezone)
     SELECT $1, b.id, 'Main', 'MAIN', 'Asia/Kolkata' FROM b RETURNING id`,
    [tenant],
  );
  const branch = br[0].id;
  const { rows: u } = await admin.query(
    `INSERT INTO users (kind, tenant_id, email, display_name)
     VALUES ('staff', $1, 'owner@perfprobe.local', 'Perf Owner') RETURNING id`,
    [tenant],
  );
  const user = u[0].id;
  // an owner role carrying every permission the product defines
  const { rows: r } = await admin.query(
    `WITH r AS (INSERT INTO roles (tenant_id, key, name, is_system) VALUES ($1,'owner','Owner',true) RETURNING id),
          p AS (INSERT INTO role_permissions (role_id, permission)
                SELECT r.id, d.permission FROM r, (SELECT DISTINCT permission FROM role_permissions) d)
     SELECT id FROM r`,
    [tenant],
  );
  await admin.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)`, [user, r[0].id]);

  await admin.query(
    `INSERT INTO members (tenant_id, branch_id, membership_number, first_name, last_name, mobile, join_date, status)
     SELECT $1, $2, 'PP' || lpad(g::text, 6, '0'),
            (ARRAY['Ravi','Suresh','Lakshmi','Anitha','Venkat','Padma','Kiran','Sruthi','Naveen','Divya'])[1 + (g % 10)],
            (ARRAY['Reddy','Naidu','Rao','Sharma','Kumar','Prasad','Varma','Chowdary'])[1 + (g % 8)],
            '+919' || lpad(g::text, 9, '0'),
            CURRENT_DATE - (g % 900),
            CASE WHEN g % 17 = 0 THEN 'expired' ELSE 'active' END
     FROM generate_series(1, $3) g`,
    [tenant, branch, N],
  );
  const { rows: pv } = await admin.query(
    `WITH p AS (INSERT INTO membership_plans (tenant_id, name) VALUES ($1,'Annual Perf') RETURNING id)
     INSERT INTO membership_plan_versions (tenant_id, plan_id, version, duration_unit, duration_value, base_price)
     SELECT $1, p.id, 1, 'months', 12, 1200000 FROM p RETURNING id, plan_id`,
    [tenant],
  );
  await admin.query(
    `INSERT INTO memberships (tenant_id, branch_id, member_id, plan_id, plan_version_id, plan_name_snapshot,
                              start_date, base_end_date, end_date, state, total_amount)
     SELECT $1, $2, m.id, $3, $4, 'Annual Perf', m.join_date, m.join_date + 365, m.join_date + 365, 'active', 1200000
     FROM members m WHERE m.tenant_id = $1`,
    [tenant, branch, pv[0].plan_id, pv[0].id],
  );
  // ~70% paid in full, 20% part-paid (leaves dues), 10% unpaid
  await admin.query(
    `INSERT INTO payments (tenant_id, branch_id, member_id, amount, method, status, payment_date, received_by)
     SELECT $1, $2, ms.member_id,
            CASE WHEN (('x'||substr(md5(ms.id::text),1,8))::bit(32)::int % 10) < 7 THEN 1200000 ELSE 500000 END,
            'cash', 'completed', ms.start_date, $3
     FROM memberships ms WHERE ms.tenant_id = $1
       AND (('x'||substr(md5(ms.id::text),1,8))::bit(32)::int % 10) < 9`,
    [tenant, branch, user],
  );
  await admin.query(
    `INSERT INTO payment_allocations (tenant_id, payment_id, membership_id, amount)
     SELECT $1, pay.id, ms.id, pay.amount
     FROM payments pay JOIN memberships ms ON ms.member_id = pay.member_id AND ms.tenant_id = $1
     WHERE pay.tenant_id = $1`,
    [tenant],
  );
  // Attendance is the biggest table a gym accumulates and the probe used to
  // ignore it entirely, so "5,000 members" measured nothing about the two
  // screens reception actually looks at all day. ~3 visits a week for three
  // years is the shape a mature gym has.
  await admin.query(
    `INSERT INTO attendance (tenant_id, branch_id, member_id, checked_in_at, method)
     SELECT $1, $2, m.id,
            (CURRENT_DATE - (d * 2))::timestamp + time '07:00' + (m.id::text ~ '[0-9]')::int * interval '1 hour',
            'qr'
     FROM members m, generate_series(0, $3::int) d
     WHERE m.tenant_id = $1`,
    [tenant, branch, VISITS_PER_MEMBER - 1],
  );
  await admin.query('ANALYZE');
  return { tenant, user };
}

async function timed(app, label, sql) {
  const { rows } = await app.query(`EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, FORMAT JSON) ${sql}`);
  const plan = rows[0]['QUERY PLAN'][0];
  return { label, ms: plan['Execution Time'] };
}

async function main() {
  const db = new pg.Client({ connectionString: ADMIN_URL });
  await db.connect();
  let results;
  try {
    await db.query('BEGIN');
    console.log(
      `building ${N}-member fixture tenant "${SLUG}" with ${(N * VISITS_PER_MEMBER).toLocaleString()} check-ins (rolled back at the end) …`,
    );
    const { tenant, user } = await buildFixture(db);

    // From here on, act as the restricted runtime role so the RLS policies
    // apply — measuring as the table owner would silently skip them and
    // report numbers no real request can achieve.
    await db.query(`SET LOCAL ROLE ${APP_ROLE}`);
    await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: user, tenant_id: tenant, kind: 'staff' }),
    ]);
    const visible = await db.query('SELECT count(*)::int AS n FROM members');
    if (visible.rows[0].n !== N) {
      throw new Error(
        `RLS returned ${visible.rows[0].n} members, expected exactly ${N} — ` +
          'the probe is not measuring what the app sees',
      );
    }

    results = [];
    results.push(
      await timed(
        db,
        'members list, page 1 (25 rows + plan/dues)',
        `SELECT p.id, p.membership_number, p.first_name, p.last_name, p.mobile, p.status,
                b.name AS branch_name, ms.plan_name_snapshot, ms.end_date::text, ms.due_amount
         FROM (SELECT m.id, m.membership_number, m.first_name, m.last_name, m.mobile, m.status,
                      m.branch_id, m.created_at
               FROM members m WHERE m.archived_at IS NULL
               ORDER BY m.created_at DESC LIMIT 25 OFFSET 0) p
         JOIN branches b ON b.id = p.branch_id
         LEFT JOIN LATERAL (
           SELECT ms.plan_name_snapshot, ms.end_date, ${DUE}::bigint::text AS due_amount
           FROM memberships ms WHERE ms.member_id = p.id AND ms.state IN ('pending','active','frozen')
           ORDER BY CASE WHEN ms.state IN ('active','frozen') AND ms.end_date >= CURRENT_DATE THEN 0
                         WHEN ms.state = 'pending' AND ms.start_date <= CURRENT_DATE THEN 1
                         WHEN ms.state IN ('active','frozen') THEN 2 ELSE 3 END,
                    ms.end_date DESC LIMIT 1) ms ON true
         ORDER BY p.created_at DESC`,
      ),
    );
    results.push(
      await timed(
        db,
        'members count (pagination total)',
        `SELECT count(*)::int FROM members m WHERE m.archived_at IS NULL`,
      ),
    );
    results.push(
      await timed(
        db,
        'members search, name term',
        `SELECT count(*)::int FROM members m WHERE m.archived_at IS NULL
           AND (m.first_name || ' ' || coalesce(m.last_name,'') ILIKE '%lakshmi%'
                OR m.mobile LIKE '%lakshmi%' OR m.membership_number ILIKE '%lakshmi%')`,
      ),
    );
    results.push(
      await timed(
        db,
        'members search, phone digits',
        `SELECT count(*)::int FROM members m WHERE m.archived_at IS NULL
           AND (m.first_name || ' ' || coalesce(m.last_name,'') ILIKE '%000004321%'
                OR m.mobile LIKE '%000004321%' OR m.membership_number ILIKE '%000004321%')`,
      ),
    );
    results.push(
      await timed(
        db,
        'members with dues filter (whole tenant)',
        `SELECT count(*)::int FROM members m WHERE m.archived_at IS NULL
           AND EXISTS (SELECT 1 FROM memberships ms
                       WHERE ms.member_id = m.id AND ms.state IN ('active','frozen','pending')
                         AND ${DUE} > 0)`,
      ),
    );
    results.push(
      await timed(
        db,
        "today's check-in list (reception screen)",
        `SELECT a.id, m.first_name, m.membership_number, a.checked_in_at::text, a.method
           FROM attendance a JOIN members m ON m.id = a.member_id
          WHERE a.checked_in_at >= (SELECT CURRENT_DATE::timestamp AT TIME ZONE t.default_timezone
                                      FROM tenants t WHERE t.id = (SELECT app.current_tenant_id()))
            AND a.checked_in_at < (SELECT (CURRENT_DATE + 1)::timestamp AT TIME ZONE t.default_timezone
                                     FROM tenants t WHERE t.id = (SELECT app.current_tenant_id()))
          ORDER BY a.checked_in_at DESC LIMIT 100`,
      ),
    );
    results.push(
      await timed(
        db,
        "today's check-in count (dashboard tile)",
        `SELECT count(*)::int FROM attendance a
          WHERE a.checked_in_at >= (SELECT CURRENT_DATE::timestamp AT TIME ZONE t.default_timezone
                                      FROM tenants t WHERE t.id = (SELECT app.current_tenant_id()))
            AND a.checked_in_at < (SELECT (CURRENT_DATE + 1)::timestamp AT TIME ZONE t.default_timezone
                                     FROM tenants t WHERE t.id = (SELECT app.current_tenant_id()))`,
      ),
    );
    results.push(
      await timed(
        db,
        'expiring-soon queue (next 7 days)',
        `SELECT count(*)::int FROM memberships ms
          WHERE ms.state IN ('active','frozen')
            AND ms.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7`,
      ),
    );
    results.push(
      await timed(
        db,
        'month-to-date collections',
        `SELECT coalesce(sum(p.amount), 0) - coalesce((
                  SELECT sum(r.amount) FROM refunds r
                   WHERE r.created_at >= date_trunc('month', CURRENT_DATE)), 0)
           FROM payments p
          WHERE p.status = 'completed'
            AND p.payment_date >= date_trunc('month', CURRENT_DATE)::date`,
      ),
    );
  } finally {
    // always: the fixture never reaches disk, and the append-only financial
    // triggers are never disabled to clean it up.
    await db.query('ROLLBACK').catch(() => {});
    await db.end();
  }

  const width = Math.max(...results.map((r) => r.label.length));
  console.log(
    `\n${N} members, ${(N * VISITS_PER_MEMBER).toLocaleString()} check-ins, runtime role, RLS on — budget ${BUDGET_MS} ms per query\n`,
  );
  let worst = 0;
  for (const r of results) {
    worst = Math.max(worst, r.ms);
    console.log(
      `  ${r.label.padEnd(width)}  ${r.ms.toFixed(1).padStart(8)} ms  ${r.ms > BUDGET_MS ? 'OVER' : 'ok'}`,
    );
  }
  if (worst > BUDGET_MS) {
    console.error(
      `\nFAIL: slowest query ${worst.toFixed(1)} ms exceeds the ${BUDGET_MS} ms budget`,
    );
    process.exit(1);
  }
  console.log(`\nPASS: slowest query ${worst.toFixed(1)} ms, within the ${BUDGET_MS} ms budget`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
