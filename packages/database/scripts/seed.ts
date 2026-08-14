/**
 * Seed a realistic (entirely fictional) Andhra Pradesh demo gym plus the
 * platform admin. Idempotent-ish: refuses to run if the demo tenant already
 * exists. Run against dev or a fresh install — never against a customer
 * production database.
 *
 * Demo credentials (DEV ONLY — printed at the end):
 *   platform admin  admin@gymflow.local
 *   gym owner       owner@demo.gymflow.local
 *   manager         manager@demo.gymflow.local
 *   receptionist    reception@demo.gymflow.local
 *   member app      gym code "apfitness", any seeded mobile, password below
 * Passwords come from SEED_PASSWORD (default only for local development).
 */
import pg from 'pg';
import { hashPassword, SYSTEM_ROLE_PERMISSIONS, computeEndDate, fiscalYearLabel, formatReceiptNumber } from '@gymflow/core';
import { addDays, todayInTz } from '@gymflow/utils';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'gymflow-dev-password';
const MEMBER_PASSWORD = process.env.SEED_MEMBER_PASSWORD ?? 'member-dev-123';

const client = new pg.Client({ connectionString: url });

async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<pg.QueryResult<T>> {
  return client.query<T>(text, params);
}

async function main() {
  await client.connect();
  const today = todayInTz('Asia/Kolkata');

  const existing = await q(`SELECT id FROM tenants WHERE slug = 'apfitness'`);
  if (existing.rowCount) {
    console.log('Demo tenant already seeded — nothing to do.');
    return;
  }

  const staffHash = await hashPassword(SEED_PASSWORD);
  const memberHash = await hashPassword(MEMBER_PASSWORD);

  await q('BEGIN');

  // ---- Platform admin ------------------------------------------------------
  const platformAdmin = (
    await q<{ id: string }>(
      `INSERT INTO users (kind, tenant_id, email, display_name)
       VALUES ('platform_admin', NULL, 'admin@gymflow.local', 'Platform Admin')
       ON CONFLICT DO NOTHING RETURNING id`,
    )
  ).rows[0];
  if (platformAdmin) {
    await q(`INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)`, [
      platformAdmin.id,
      staffHash,
    ]);
  }

  // ---- Tenant / brand / branches ------------------------------------------
  const tenant = (
    await q<{ id: string }>(
      `INSERT INTO tenants (slug, name, status, subscription_tier)
       VALUES ('apfitness', 'Sri Vinayaka Fitness (Demo)', 'active', 'standard') RETURNING id`,
    )
  ).rows[0]!;
  const T = tenant.id;

  const brand = (
    await q<{ id: string }>(
      `INSERT INTO brands (tenant_id, name, primary_color, support_phone, support_whatsapp)
       VALUES ($1, 'Sri Vinayaka Fitness', '#16a34a', '+919000000001', '+919000000001') RETURNING id`,
      [T],
    )
  ).rows[0]!;

  const [main, second] = (
    await q<{ id: string }>(
      `INSERT INTO branches (tenant_id, brand_id, name, code, city, district, state, pin_code, phone)
       VALUES
        ($1, $2, 'Madanapalle Main', 'MAIN', 'Madanapalle', 'Annamayya', 'Andhra Pradesh', '517325', '+919000000001'),
        ($1, $2, 'Punganur Branch', 'PNGR', 'Punganur', 'Chittoor', 'Andhra Pradesh', '517247', '+919000000002')
       RETURNING id`,
      [T, brand.id],
    )
  ).rows as [{ id: string }, { id: string }];

  await q(`INSERT INTO gym_settings (tenant_id, receipt_prefix) VALUES ($1, 'SVF')`, [T]);
  for (const key of ['attendance', 'pt', 'leads'] as const) {
    await q(`INSERT INTO feature_flags (tenant_id, key, enabled) VALUES ($1, $2, true)`, [T, key]);
  }

  // ---- Roles ---------------------------------------------------------------
  const roleIds: Record<string, string> = {};
  for (const [key, perms] of Object.entries(SYSTEM_ROLE_PERMISSIONS)) {
    const role = (
      await q<{ id: string }>(
        `INSERT INTO roles (tenant_id, key, name, is_system) VALUES ($1, $2, initcap(replace($2, '_', ' ')), true) RETURNING id`,
        [T, key],
      )
    ).rows[0]!;
    roleIds[key] = role.id;
    for (const p of perms) {
      await q(`INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)`, [role.id, p]);
    }
  }
  const memberRole = (
    await q<{ id: string }>(
      `INSERT INTO roles (tenant_id, key, name, is_system) VALUES ($1, 'member', 'Member', true) RETURNING id`,
      [T],
    )
  ).rows[0]!;
  roleIds.member = memberRole.id;

  // ---- Staff ---------------------------------------------------------------
  async function staff(email: string, name: string, roleKey: string): Promise<string> {
    const u = (
      await q<{ id: string }>(
        `INSERT INTO users (kind, tenant_id, email, display_name)
         VALUES ('staff', $1, $2, $3) RETURNING id`,
        [T, email, name],
      )
    ).rows[0]!;
    await q(`INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)`, [u.id, staffHash]);
    await q(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [u.id, roleIds[roleKey]]);
    return u.id;
  }
  const ownerId = await staff('owner@demo.gymflow.local', 'Venkata Rao (Owner)', 'owner');
  const managerId = await staff('manager@demo.gymflow.local', 'Sridevi (Manager)', 'branch_manager');
  const receptionId = await staff('reception@demo.gymflow.local', 'Kiran (Reception)', 'receptionist');
  const accountantId = await staff('accounts@demo.gymflow.local', 'Prasad (Accounts)', 'accountant');

  // ---- Trainers ------------------------------------------------------------
  const trainerRows = (
    await q<{ id: string }>(
      `INSERT INTO trainers (tenant_id, branch_id, name, mobile, specialization)
       VALUES
        ($1, $2, 'Suresh Babu', '+919000000011', 'Strength & conditioning'),
        ($1, $3, 'Anitha Kumari', '+919000000012', 'Weight loss, Zumba')
       RETURNING id`,
      [T, main.id, second.id],
    )
  ).rows as [{ id: string }, { id: string }];
  const [trainer1, trainer2] = trainerRows;

  // ---- Plans (each with version 1) ----------------------------------------
  interface PlanSpec {
    name: string;
    months: number;
    price: number; // paise
    joining: number;
    tags?: string[];
    timings?: string | null;
  }
  const planSpecs: PlanSpec[] = [
    { name: '1 Month', months: 1, price: 100000, joining: 50000 },
    { name: '3 Month', months: 3, price: 250000, joining: 50000 },
    { name: '6 Month', months: 6, price: 450000, joining: 0 },
    { name: '12 Month', months: 12, price: 800000, joining: 0 },
    { name: 'Student 3 Month', months: 3, price: 200000, joining: 0, tags: ['student'] },
    { name: 'Womens Morning Monthly', months: 1, price: 80000, joining: 0, tags: ['women'], timings: '05:30-10:30' },
  ];
  const plans: Record<string, { planId: string; versionId: string; months: number; price: number; joining: number }> = {};
  for (const [i, p] of planSpecs.entries()) {
    const plan = (
      await q<{ id: string }>(
        `INSERT INTO membership_plans (tenant_id, name, public_description, display_order, tags)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [T, p.name, `${p.months}-month membership`, i, p.tags ?? []],
      )
    ).rows[0]!;
    const ver = (
      await q<{ id: string }>(
        `INSERT INTO membership_plan_versions
           (tenant_id, plan_id, version, duration_unit, duration_value, base_price, joining_fee,
            grace_period_days, freeze_allowance_days, max_freezes, allowed_timings)
         VALUES ($1, $2, 1, 'months', $3, $4, $5, 3, 30, 2, $6) RETURNING id`,
        [T, plan.id, p.months, p.price, p.joining, p.timings ?? null],
      )
    ).rows[0]!;
    plans[p.name] = { planId: plan.id, versionId: ver.id, months: p.months, price: p.price, joining: p.joining };
  }

  // ---- Add-ons -------------------------------------------------------------
  const pt8 = (
    await q<{ id: string }>(
      `INSERT INTO addon_packages (tenant_id, kind, name, session_count, validity_days, price)
       VALUES ($1, 'personal_training', 'PT 8 Sessions', 8, 45, 200000) RETURNING id`,
      [T],
    )
  ).rows[0]!;
  await q(
    `INSERT INTO addon_packages (tenant_id, kind, name, session_count, validity_days, price)
     VALUES ($1, 'personal_training', 'PT 12 Sessions', 12, 60, 280000),
            ($1, 'group_class', 'Zumba Monthly', NULL, 30, 60000),
            ($1, 'locker', 'Locker Monthly', NULL, 30, 20000)`,
    [T],
  );

  // ---- Promotions ----------------------------------------------------------
  const promoNY = (
    await q<{ id: string }>(
      `INSERT INTO promotions (tenant_id, code, name, discount_kind, discount_value, valid_from, valid_to, audience)
       VALUES ($1, 'NEWYEAR26', 'New Year Offer', 'percentage', 1000, $2, $3, 'all') RETURNING id`,
      [T, addDays(today, -30), addDays(today, 60)],
    )
  ).rows[0]!;
  await q(
    `INSERT INTO promotions (tenant_id, code, name, discount_kind, discount_value, max_discount_amount, valid_from, valid_to, audience, is_active)
     VALUES
      ($1, 'WINBACK15', 'Win-back Offer', 'percentage', 1500, 100000, $2, $3, 'win_back', true),
      ($1, 'SANKRANTI25', 'Sankranti Offer (over)', 'flat', 50000, NULL, $4, $5, 'all', true)`,
    [T, addDays(today, -10), addDays(today, 90), addDays(today, -240), addDays(today, -180)],
  );

  // ---- Members -------------------------------------------------------------
  const firstNames = [
    'Ravi', 'Lakshmi', 'Suresh', 'Padma', 'Krishna', 'Anjali', 'Ramesh', 'Sita',
    'Naveen', 'Divya', 'Mahesh', 'Swathi', 'Kiran', 'Bhavani', 'Srinivas', 'Radha',
    'Chandra', 'Manasa', 'Prakash', 'Jyothi', 'Venu', 'Sravani', 'Harish', 'Kavya',
    'Gopal', 'Nandini', 'Rajesh', 'Sushma', 'Balaji', 'Meghana',
  ];
  const lastNames = ['Kumar', 'Devi', 'Reddy', 'Naidu', 'Rao', 'Prasad', 'Chowdary', 'Goud'];
  const villages = ['Madanapalle', 'Punganur', 'B Kothakota', 'Kurabalakota', 'Nimmanapalle'];

  // Membership scenarios keyed by index ranges (30 members):
  //  0-14 active (various plans), 15-19 expiring within 7 days,
  //  20-24 expired 1-30 days ago, 25 frozen, 26 pending (starts next week),
  //  27-28 long-lapsed, 29 trial lead converted recently
  let memberSeq = 0;
  const memberIds: string[] = [];
  const fy = fiscalYearLabel(today);
  let receiptSeq = 0;

  async function makeMember(i: number): Promise<void> {
    const fn = firstNames[i % firstNames.length]!;
    const ln = lastNames[i % lastNames.length]!;
    const branch = i % 3 === 2 ? second.id : main.id;
    const mobile = `+9198765432${String(10 + i).slice(-2)}`;
    memberSeq += 1;
    const num = `SVF${String(1000 + memberSeq)}`;

    // Pick plan + start date per scenario
    let planName = ['1 Month', '3 Month', '6 Month', '12 Month'][i % 4]!;
    let start: string;
    if (i < 15) {
      // active, started recently enough to still be running
      const p = plans[planName]!;
      start = addDays(today, -Math.min(20 + i, p.months * 28 - 10));
    } else if (i < 20) {
      planName = i % 2 ? '1 Month' : '3 Month';
      const p = plans[planName]!;
      // expiring within 0..6 days: choose start so end = today + (i-15)
      start = addDays(computeStartForEnd(addDays(today, i - 15), p.months), 0);
    } else if (i < 25) {
      planName = '1 Month';
      start = computeStartForEnd(addDays(today, -(i - 19)), 1); // expired 1..5 days ago
    } else if (i === 25) {
      planName = '3 Month';
      start = addDays(today, -30);
    } else if (i === 26) {
      planName = '3 Month';
      start = addDays(today, 7); // future start
    } else if (i < 29) {
      planName = '1 Month';
      start = computeStartForEnd(addDays(today, -(60 + (i - 27) * 30)), 1); // long lapsed
    } else {
      planName = '1 Month';
      start = addDays(today, -2);
    }

    const p = plans[planName]!;
    const end = computeEndDate({ startDate: start, durationUnit: 'months', durationValue: p.months });
    const isExpired = end < today;
    const state = i === 25 ? 'frozen' : i === 26 ? 'pending' : isExpired ? 'expired' : 'active';
    const memberStatus =
      i === 25 ? 'frozen' : i === 26 ? 'pending_activation' : isExpired ? 'expired' : 'active';

    const member = (
      await q<{ id: string }>(
        `INSERT INTO members
          (tenant_id, branch_id, membership_number, first_name, last_name, mobile, gender,
           village, district, state, pin_code, join_date, status, assigned_trainer_id, referral_source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Annamayya','Andhra Pradesh','517325',$9,$10,$11,$12)
         RETURNING id`,
        [
          T, branch, num, fn, ln, mobile,
          i % 3 === 1 ? 'female' : 'male',
          villages[i % villages.length],
          start < today ? start : today,
          memberStatus,
          i % 5 === 0 ? (branch === main.id ? trainer1!.id : trainer2!.id) : null,
          ['walk_in', 'referral', 'whatsapp', 'social'][i % 4],
        ],
      )
    ).rows[0]!;
    memberIds.push(member.id);

    const total = p.price + (i < 15 && i % 4 === 0 ? p.joining : 0);
    const usePromo = i % 7 === 0;
    const discount = usePromo ? Math.round(total * 0.1) : 0;

    const membership = (
      await q<{ id: string }>(
        `INSERT INTO memberships
          (tenant_id, branch_id, member_id, plan_id, plan_version_id, plan_name_snapshot,
           start_date, base_end_date, end_date, grace_period_days, state, total_amount,
           discount_amount, promotion_id, sold_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,3,$9,$10,$11,$12,$13) RETURNING id`,
        [
          T, branch, member.id, p.planId, p.versionId, planName,
          start, end, state, total - discount, discount,
          usePromo ? promoNY.id : null, receptionId,
        ],
      )
    ).rows[0]!;
    await q(
      `INSERT INTO membership_events (tenant_id, membership_id, type, data, actor_id)
       VALUES ($1, $2, 'sold', $3, $4)`,
      [T, membership.id, JSON.stringify({ plan: planName, total: total - discount }), receptionId],
    );
    if (usePromo) {
      await q(
        `INSERT INTO promotion_redemptions (tenant_id, promotion_id, member_id, membership_id, discount_amount)
         VALUES ($1,$2,$3,$4,$5)`,
        [T, promoNY.id, member.id, membership.id, discount],
      );
    }

    // Payment + receipt (skip for pending member to leave an outstanding case)
    if (i !== 26) {
      const payment = (
        await q<{ id: string }>(
          `INSERT INTO payments (tenant_id, branch_id, member_id, amount, method, payment_date, received_by, external_reference)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [
            T, branch, member.id, total - discount,
            ['cash', 'upi', 'cash', 'upi', 'card_debit'][i % 5],
            start < today ? start : today, receptionId,
            i % 2 ? `UTR${300000 + i}` : null,
          ],
        )
      ).rows[0]!;
      await q(
        `INSERT INTO payment_allocations (tenant_id, payment_id, membership_id, amount)
         VALUES ($1,$2,$3,$4)`,
        [T, payment.id, membership.id, total - discount],
      );
      receiptSeq += 1;
      await q(
        `INSERT INTO receipts (tenant_id, branch_id, payment_id, receipt_number, sequence, fiscal_year)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [T, branch, payment.id, formatReceiptNumber({ prefix: 'SVF', fiscalYear: fy, sequence: receiptSeq }), receiptSeq, fy],
      );
    }

    // Freeze record for the frozen member
    if (i === 25) {
      await q(
        `INSERT INTO membership_freezes (tenant_id, membership_id, start_date, planned_end_date, reason, authorized_by)
         VALUES ($1,$2,$3,$4,'Medical - knee injury',$5)`,
        [T, membership.id, addDays(today, -5), addDays(today, 10), managerId],
      );
    }

    // Attendance: recent visits for active members
    if (state === 'active' && i < 15) {
      for (let d = 0; d < 5; d++) {
        if ((i + d) % 2 === 0) {
          await q(
            `INSERT INTO attendance (tenant_id, branch_id, member_id, method, checked_in_at, checked_in_by)
             VALUES ($1,$2,$3,'reception', now() - ($4 || ' days')::interval - interval '2 hours', $5)`,
            [T, branch, member.id, d, receptionId],
          );
        }
      }
    }

    // PT add-on for a few members
    if (i % 6 === 0 && state === 'active') {
      const addon = (
        await q<{ id: string }>(
          `INSERT INTO member_addons
            (tenant_id, member_id, addon_package_id, name_snapshot, price_snapshot, trainer_id,
             sessions_total, sessions_used, start_date, end_date)
           VALUES ($1,$2,$3,'PT 8 Sessions',200000,$4,8,$5,$6,$7) RETURNING id`,
          [T, member.id, pt8.id, branch === main.id ? trainer1!.id : trainer2!.id, i % 4, start, addDays(start, 45)],
        )
      ).rows[0]!;
      const hour = String(6 + Math.floor(i / 3)).padStart(2, '0');
      await q(
        `INSERT INTO trainer_sessions (tenant_id, branch_id, trainer_id, member_id, member_addon_id, session_date, start_time, end_time, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'scheduled')`,
        [T, branch, branch === main.id ? trainer1!.id : trainer2!.id, member.id, addon.id,
         addDays(today, 1 + (i % 3)), `${hour}:00`, `${hour}:55`],
      );
    }
  }

  function computeStartForEnd(end: string, months: number): string {
    // approximate inverse of computeEndDate for seed purposes
    const [y, m, d] = end.split('-').map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, d + 1));
    dt.setUTCMonth(dt.getUTCMonth() - months);
    return dt.toISOString().slice(0, 10);
  }

  for (let i = 0; i < 30; i++) await makeMember(i);

  // ---- Member app logins for the first three members ----------------------
  for (let i = 0; i < 3; i++) {
    const m = (
      await q<{ id: string; mobile: string; first_name: string }>(
        `SELECT id, mobile, first_name FROM members WHERE id = $1`,
        [memberIds[i]],
      )
    ).rows[0]!;
    const u = (
      await q<{ id: string }>(
        `INSERT INTO users (kind, tenant_id, phone, display_name) VALUES ('member', $1, $2, $3) RETURNING id`,
        [T, m.mobile, m.first_name],
      )
    ).rows[0]!;
    await q(`INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)`, [u.id, memberHash]);
    await q(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [u.id, roleIds.member]);
    await q(`UPDATE members SET user_id = $1 WHERE id = $2`, [u.id, m.id]);
  }

  // ---- Leads ---------------------------------------------------------------
  const leadNames: [string, string, string][] = [
    ['Teja', '+919111111101', 'new'],
    ['Mounika', '+919111111102', 'contacted'],
    ['Vamsi', '+919111111103', 'follow_up'],
    ['Sandhya', '+919111111104', 'trial_scheduled'],
    ['Charan', '+919111111105', 'interested'],
  ];
  for (const [name, mobile, status] of leadNames) {
    await q(
      `INSERT INTO leads (tenant_id, branch_id, name, mobile, source, status, follow_up_date, assigned_to, interested_plan_id)
       VALUES ($1,$2,$3,$4,'walk_in',$5,$6,$7,$8)`,
      [T, main.id, name, mobile, status, addDays(today, 1), receptionId, plans['3 Month']!.planId],
    );
  }

  // Sync receipt sequence table so future receipts continue from the seed.
  await q(
    `INSERT INTO receipt_sequences (tenant_id, fiscal_year, next_seq) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, fiscal_year) DO UPDATE SET next_seq = $3`,
    [T, fy, receiptSeq + 1],
  );

  await q(
    `INSERT INTO audit_logs (tenant_id, actor_id, actor_label, action, entity_type, entity_id, after)
     VALUES ($1, $2, 'seed script', 'tenant.seed', 'tenant', $1, $3)`,
    [T, ownerId, JSON.stringify({ members: 30, branches: 2 })],
  );

  await q('COMMIT');

  console.log('Seed complete.');
  console.log('  Tenant: Sri Vinayaka Fitness (Demo) — slug "apfitness", 2 branches, 30 members');
  console.log('  Staff logins (password from SEED_PASSWORD, default dev-only):');
  console.log('    admin@gymflow.local (platform) / owner@demo.gymflow.local');
  console.log('    manager@demo.gymflow.local / reception@demo.gymflow.local / accounts@demo.gymflow.local');
  console.log('  Member app: gym code "apfitness", mobiles 9876543210/11/12, SEED_MEMBER_PASSWORD');
  if (!process.env.SEED_PASSWORD) {
    console.warn('  WARNING: default dev passwords in use. Set SEED_PASSWORD for anything shared.');
  }
}

main()
  .catch(async (err) => {
    try { await q('ROLLBACK'); } catch { /* not in tx */ }
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => client.end());
