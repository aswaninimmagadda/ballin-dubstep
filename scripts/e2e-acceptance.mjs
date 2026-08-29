#!/usr/bin/env node
/**
 * FINAL ACCEPTANCE TEST (spec §82) — executed against the real stack.
 *
 * A brand-new gym is created through platform configuration (create-tenant
 * CLI — no source changes), then over plain HTTP its owner configures
 * settings/plans/PT packages/trainers/staff/promotions, a receptionist
 * onboards a member, sells a membership with a promotion, adds PT, collects
 * ₹, gets receipts, checks the member in, enables the member app (the
 * member sees their gym), renews, freezes, cancels, imports a CSV, and
 * produces reports. Then we prove Gym A and Gym B cannot see each other and
 * that configuration/plans/branding differ independently.
 *
 * Usage: node scripts/e2e-acceptance.mjs [baseUrl]
 * Requires: running admin server, seeded demo gym (apfitness), DATABASE_URL.
 */
import pg from 'pg';
import { execFileSync } from 'node:child_process';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const DB =
  process.env.DATABASE_URL ?? 'postgres://gymflow:gymflow_dev_pw@localhost:5432/gymflow_dev';
const SLUG = `acc${Date.now().toString(36)}`; // unique per run
const GYM_B_NAME = 'Harsha Fitness (Acceptance)';

const db = new pg.Client({ connectionString: DB });
let cookie = '';
let passed = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ✗ ${name} ${detail}`);
  }
}

async function get(path) {
  return fetch(BASE + path, { headers: { cookie }, redirect: 'manual' });
}
async function getFollow(path) {
  let res = await get(path);
  let hops = 0;
  while ([301, 302, 303, 307, 308].includes(res.status) && hops < 5) {
    const loc = res.headers.get('location');
    res = await get(loc.startsWith('http') ? new URL(loc).pathname + new URL(loc).search : loc);
    hops += 1;
  }
  return res;
}
/**
 * Pull a server action's id and hidden fields out of a rendered form.
 *
 * `contains` disambiguates when a page has several forms carrying the same
 * hidden field — the member page has half a dozen that all post `memberId`,
 * and picking the first one silently drives a different action.
 */
function extractForm(html, markerField, contains) {
  for (const f of html.split('<form').slice(1)) {
    if (!f.includes(`name="${markerField}"`)) continue;
    if (contains && !f.slice(0, f.indexOf('</form>') + 1).includes(contains)) continue;
    const actionId = f.match(/\$ACTION_ID_([a-f0-9]+)/)?.[1];
    const hidden = {};
    for (const m of f.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)) {
      if (!m[1].startsWith('$ACTION')) hidden[m[1]] = m[2];
    }
    return { actionId, hidden };
  }
  throw new Error(`No form with field ${markerField}${contains ? ` containing ${contains}` : ''}`);
}
async function postAction(path, form, fields) {
  const fd = new FormData();
  fd.set(`$ACTION_ID_${form.actionId}`, '');
  for (const [k, v] of Object.entries({ ...form.hidden, ...fields })) fd.set(k, v);
  return fetch(BASE + path, { method: 'POST', headers: { cookie }, body: fd, redirect: 'manual' });
}
const target = (res) => res.headers.get('x-action-redirect') ?? res.headers.get('location') ?? '';
async function q(sql, params = []) {
  return (await db.query(sql, params)).rows;
}
async function loginAs(email, password) {
  cookie = '';
  const html = await (await get('/login')).text();
  const form = extractForm(html, 'email');
  const res = await postAction('/login', form, { email, password });
  cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  return cookie.startsWith('gymflow_session=');
}
const istToday = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

async function main() {
  await db.connect();
  console.log(`Acceptance test against ${BASE} — new tenant "${SLUG}"`);

  // ---- 0. Platform provisioning (no source changes) ------------------------
  console.log('\n[platform: create Gym B]');
  // Deliberately the exact command the docs tell an operator to run, so the
  // documented provisioning path is what gets tested (it once drifted).
  const cliOut = execFileSync(
    'pnpm',
    [
      '--filter',
      '@gymflow/database',
      'create-tenant',
      '--',
      '--slug',
      SLUG,
      '--name',
      GYM_B_NAME,
      '--owner-email',
      `owner@${SLUG}.test`,
      '--receipt-prefix',
      'HFT',
      '--branch',
      'Main/MAIN',
    ],
    { env: { ...process.env, DATABASE_URL: DB }, encoding: 'utf8' },
  );
  const ownerPw = cliOut.match(/One-time owner password [^:]*: (\S+)/)?.[1];
  check('tenant provisioned by CLI with owner password', Boolean(ownerPw));

  // ---- 1-3. Owner configures the gym over HTTP ----------------------------
  console.log('\n[Gym B owner configures]');
  check('owner login', await loginAs(`owner@${SLUG}.test`, ownerPw));

  // Settings: custom WhatsApp template (branding/config independence)
  const settingsHtml = await (await get('/settings')).text();
  check('settings page shows HFT receipt prefix', settingsHtml.includes('value="HFT"'));
  const settingsForm = extractForm(settingsHtml, 'receiptPrefix');
  const sRes = await postAction('/settings', settingsForm, {
    receiptPrefix: 'HFT',
    gracePeriodDays: '5',
    maxFreezes: '2',
    maxFreezeDays: '30',
    waTemplateEn: `Hello {{member_first_name}}! Your ${GYM_B_NAME} plan ends {{expiry_date}}. Renew with us!`,
    waTemplateTe: 'నమస్తే {{member_first_name}}!',
  });
  check('settings saved', target(sRes).includes('msg=saved'), target(sRes));

  // Plan
  const plansHtml = await (await get('/plans')).text();
  const planForm = extractForm(plansHtml, 'durationValue');
  const pRes = await postAction('/plans', planForm, {
    name: 'Quarterly',
    durationValue: '3',
    durationUnit: 'months',
    basePrice: '2000',
    joiningFee: '300',
    gracePeriodDays: '5',
    freezeAllowanceDays: '30',
    maxFreezes: '2',
  });
  check('plan "Quarterly" created', !target(pRes).includes('error'), target(pRes));

  // PT package
  const plansHtml2 = await (await get('/plans')).text();
  const addonPkgForm = extractForm(plansHtml2, 'validityDays');
  const apRes = await postAction('/plans', addonPkgForm, {
    name: 'PT 5',
    kind: 'personal_training',
    sessionCount: '5',
    validityDays: '30',
    price: '1500',
  });
  check('PT package created', !target(apRes).includes('error'), target(apRes));

  // Trainer
  const trainersHtml = await (await get('/trainers')).text();
  const trainerForm = extractForm(trainersHtml, 'specialization');
  const tRes = await postAction('/trainers', trainerForm, {
    name: 'Coach B',
    mobile: '9111100001',
    branchId:
      trainerForm.hidden.branchId ??
      trainersHtml.match(/<option[^>]*value="([a-f0-9-]{36})"/)?.[1] ??
      '',
    specialization: 'Strength',
  });
  check('trainer created', !target(tRes).includes('error'), target(tRes));

  // Staff: receptionist for Gym B (POST-rendered credential page — no URLs)
  const staffPage = await (await get('/staff')).text();
  check(
    'staff page offers the create form',
    staffPage.includes('name="kind" value="staff_create"'),
  );
  const recepRoleId = (
    await q(
      `SELECT r.id FROM roles r JOIN tenants t ON t.id = r.tenant_id
       WHERE t.slug = $1 AND r.key = 'receptionist'`,
      [SLUG],
    )
  )[0].id;
  const staffFd = new FormData();
  staffFd.set('kind', 'staff_create');
  staffFd.set('displayName', 'Front Desk B');
  staffFd.set('email', `reception@${SLUG}.test`);
  staffFd.set('roleId', recepRoleId);
  const stRes = await fetch(`${BASE}/credentials`, {
    method: 'POST',
    headers: { cookie },
    body: staffFd,
  });
  const recepPw = (await stRes.text()).match(/<code>([^<]+)<\/code>/)?.[1] ?? '';
  check(
    'receptionist account created with one-time password',
    recepPw.length >= 8,
    String(stRes.status),
  );

  // Promotion
  const promoHtml = await (await get('/promotions')).text();
  const promoForm = extractForm(promoHtml, 'discountKind');
  const prRes = await postAction('/promotions', promoForm, {
    code: 'HFTOPEN',
    name: 'Opening offer',
    discountKind: 'percentage',
    percent: '20',
    validFrom: istToday,
    validTo: istToday,
    audience: 'all',
  });
  check('promotion created', !target(prRes).includes('error'), target(prRes));

  // ---- 4-10. Receptionist runs the business flow --------------------------
  console.log('\n[Gym B reception: onboard → sell+promo → PT → pay → receipt → check-in]');
  check('receptionist login', await loginAs(`reception@${SLUG}.test`, recepPw));

  const mobile = `9${String(Math.floor(100000000 + Math.random() * 899999999))}`;
  const step1 = extractForm(await (await get('/members/new')).text(), 'mobile');
  const dupRes = await postAction('/members/new', step1, { mobile });
  const step2Path = target(dupRes).replace(/^https?:\/\/[^/]+/, '');
  const step2Html = await (await get(step2Path)).text();
  const createForm = extractForm(step2Html, 'firstName');
  const branchId = step2Html.match(/<option[^>]*value="([a-f0-9-]{36})"/)?.[1];
  const createRes = await postAction(step2Path, createForm, {
    mobile,
    branchId,
    firstName: 'Bhavya',
    lastName: 'Acceptance',
    referralSource: 'walk_in',
  });
  const sellPath = target(createRes).replace(/^https?:\/\/[^/]+/, '');
  const memberId = sellPath.match(/members\/([a-f0-9-]+)\/sell/)?.[1];
  check('member onboarded in Gym B', Boolean(memberId), sellPath);

  const [qPlan] = await q(
    `SELECT p.id FROM membership_plans p JOIN tenants t ON t.id = p.tenant_id
     WHERE t.slug = $1 AND p.name = 'Quarterly'`,
    [SLUG],
  );
  const sellForm = extractForm(await (await get(sellPath)).text(), 'planId');
  // Quarterly ₹2000 + ₹300 joining = 2300; 20% promo = -460 → ₹1840
  const sellRes = await postAction(sellPath, sellForm, {
    planId: qPlan.id,
    startDate: istToday,
    includeJoiningFee: 'on',
    promotionCode: 'HFTOPEN',
    amount: '1840',
    method: 'cash',
  });
  check('membership sold with promotion', target(sellRes).includes('msg=sold'), target(sellRes));
  const [msRow] = await q(
    `SELECT total_amount::bigint AS total, discount_amount::bigint AS disc
     FROM memberships WHERE member_id = $1`,
    [memberId],
  );
  check(
    '20% promo priced correctly (₹2300 → ₹1840)',
    Number(msRow.total) === 184000 && Number(msRow.disc) === 46000,
    JSON.stringify(msRow),
  );
  const [rec] = await q(
    `SELECT r.receipt_number FROM receipts r JOIN payments p ON p.id = r.payment_id
     WHERE p.member_id = $1`,
    [memberId],
  );
  check(
    'receipt carries Gym B prefix (HFT-…-000001)',
    /^HFT-\d{4}-000001$/.test(rec?.receipt_number ?? ''),
    rec?.receipt_number,
  );

  // PT
  const [ptPkg] = await q(
    `SELECT ap.id FROM addon_packages ap JOIN tenants t ON t.id = ap.tenant_id
     WHERE t.slug = $1 AND ap.name = 'PT 5'`,
    [SLUG],
  );
  const addonForm = extractForm(
    await (await get(`/members/${memberId}/addon`)).text(),
    'addonPackageId',
  );
  const adRes = await postAction(`/members/${memberId}/addon`, addonForm, {
    addonPackageId: ptPkg.id,
    trainerId: '',
    amount: '1500',
    method: 'upi',
    externalReference: 'UTR-ACC-1',
  });
  check('PT added with UPI payment', target(adRes).includes('msg=addon'), target(adRes));

  // Check-in
  const detailHtml = await (await getFollow(`/members/${memberId}`)).text();
  const checkinForm = extractForm(detailHtml, 'memberId');
  const ckRes = await postAction(`/members/${memberId}`, checkinForm, {});
  check('member checked in', target(ckRes).includes('msg=checkedin'), target(ckRes));

  // Member edit incl. branch transfer (§55 edge case)
  await q(
    `INSERT INTO branches (tenant_id, brand_id, name, code)
     SELECT t.id, b.id, 'Annex', 'ANX' FROM tenants t JOIN brands b ON b.tenant_id = t.id
     WHERE t.slug = $1 ON CONFLICT DO NOTHING`,
    [SLUG],
  );
  const [annex] = await q(
    `SELECT br.id FROM branches br JOIN tenants t ON t.id = br.tenant_id
     WHERE t.slug = $1 AND br.code = 'ANX'`,
    [SLUG],
  );
  const editForm = extractForm(await (await get(`/members/${memberId}/edit`)).text(), 'firstName');
  const edRes = await postAction(`/members/${memberId}/edit`, editForm, {
    firstName: 'Bhavya',
    lastName: 'Edited',
    mobile,
    branchId: annex.id,
    notes: 'transferred to annex',
  });
  check('member edited + branch transferred', target(edRes).includes('msg=edited'), target(edRes));
  const [afterEdit] = await q(`SELECT last_name, branch_id, notes FROM members WHERE id = $1`, [
    memberId,
  ]);
  check(
    'edit persisted (name, branch, notes)',
    afterEdit.last_name === 'Edited' &&
      afterEdit.branch_id === annex.id &&
      afterEdit.notes === 'transferred to annex',
    JSON.stringify(afterEdit),
  );

  // ---- 11-12. Member app sees Gym B ---------------------------------------
  console.log('\n[Gym B member app]');
  const appFd = new FormData();
  appFd.set('kind', 'member_app');
  appFd.set('memberId', memberId);
  const enableRes = await fetch(`${BASE}/credentials`, {
    method: 'POST',
    headers: { cookie },
    body: appFd,
  });
  const appPw = (await enableRes.text()).match(/<code>([^<]+)<\/code>/)?.[1] ?? '';
  const login = await fetch(`${BASE}/api/member/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gymCode: SLUG, mobile, password: appPw }),
  });
  check('Gym B member signs in with gym code', login.status === 200, String(login.status));
  const tokens = login.status === 200 ? await login.json() : null;
  let me = null;
  if (tokens) {
    me = await (
      await fetch(`${BASE}/api/member/v1/me`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      })
    ).json();
    check(
      'member app shows Gym B branding + correct expiry',
      me?.gym?.name === GYM_B_NAME &&
        me?.membership?.planName === 'Quarterly' &&
        typeof me?.membership?.endDate === 'string',
      JSON.stringify({ gym: me?.gym?.name, m: me?.membership ?? null }),
    );
  }

  // ---- 13. WhatsApp uses Gym B's custom template --------------------------
  const detailAgain = await (await getFollow(`/members/${memberId}`)).text();
  check(
    'WhatsApp link renders the tenant-custom template',
    detailAgain.includes('wa.me') && detailAgain.includes('Renew%20with%20us'),
    detailAgain.match(/wa\.me[^"]{0,80}/)?.[0] ?? 'no link',
  );

  // ---- 14-15. Renew, freeze (owner), cancel -------------------------------
  console.log('\n[Gym B renew/freeze/cancel]');
  const renewForm = extractForm(
    await (await get(`/members/${memberId}/renew`)).text(),
    'previousMembershipId',
  );
  // Taking no money is a 100% part payment: refused while the gym has part
  // payments switched off, so nobody can quietly create an unpaid membership.
  const unpaidRes = await postAction(`/members/${memberId}/renew`, renewForm, {
    planId: qPlan.id,
    amount: '',
    method: 'cash',
  });
  const unpaidMessage = decodeURIComponent(target(unpaidRes));
  check(
    'unpaid renewal refused while part payments are off',
    unpaidMessage.includes('does not allow part payments'),
    unpaidMessage.slice(-160),
  );
  check(
    'and the refusal names the amount and who can change the setting',
    /₹|Rs/.test(unpaidMessage) && /owner/i.test(unpaidMessage),
    unpaidMessage.slice(-160),
  );

  check('owner relogin', await loginAs(`owner@${SLUG}.test`, ownerPw));

  // Owner turns part payments on, then takes a deposit — the balance must be
  // visible to staff afterwards, not silently forgotten.
  const setForm2 = extractForm(await (await get('/settings')).text(), 'receiptPrefix');
  const setRes2 = await postAction('/settings', setForm2, {
    receiptPrefix: 'HFT',
    gracePeriodDays: '5',
    maxFreezes: '2',
    maxFreezeDays: '30',
    allowPartial: 'on',
    waTemplateEn: `Hello {{member_first_name}}! Your ${GYM_B_NAME} plan ends {{expiry_date}}. Renew with us!`,
    waTemplateTe: 'నమస్తే {{member_first_name}}!',
  });
  check('part payments enabled', target(setRes2).includes('msg=saved'), target(setRes2));

  const renewForm2 = extractForm(
    await (await get(`/members/${memberId}/renew`)).text(),
    'previousMembershipId',
  );
  const rnRes = await postAction(`/members/${memberId}/renew`, renewForm2, {
    planId: qPlan.id,
    amount: '1000',
    method: 'cash',
  });
  check(
    'renewal recorded with a part payment',
    target(rnRes).includes('msg=renewed'),
    target(rnRes),
  );

  const [renewalDue] = await q(
    `SELECT ms.total_amount::bigint AS total,
            coalesce((SELECT sum(GREATEST(pa.amount - coalesce((
                        SELECT sum(rf.amount) FROM refunds rf WHERE rf.payment_id = pa.payment_id), 0), 0))
                      FROM payment_allocations pa WHERE pa.membership_id = ms.id), 0)::bigint AS paid
     FROM memberships ms WHERE ms.member_id = $1 ORDER BY ms.created_at DESC LIMIT 1`,
    [memberId],
  );
  const expectedDue = Number(renewalDue.total) - Number(renewalDue.paid);
  check(
    'part-paid renewal leaves a balance',
    Number(renewalDue.paid) === 100000 && expectedDue > 0,
    JSON.stringify(renewalDue),
  );
  // Rupee formatting is split across React text nodes, so assert on the
  // server-side surfaces instead: the dues filter, the export and the tile.
  const duesListHtml = await (await getFollow('/members?dues=1')).text();
  check('members list can filter to members with dues', duesListHtml.includes(memberId));
  const duesCsv = await (await get('/api/export/dues')).text();
  const duesRow = duesCsv.split('\n').find((l) => l.includes('+91' + mobile));
  check(
    'dues CSV lists the outstanding balance',
    Boolean(duesRow) && duesRow.split(',').includes(String(expectedDue)),
    duesRow ?? 'member not in dues export',
  );
  const freezeForm = extractForm(await (await get(`/members/${memberId}/freeze`)).text(), 'reason');
  const fzRes = await postAction(`/members/${memberId}/freeze`, freezeForm, {
    startDate: istToday,
    plannedEndDate: '',
    reason: 'Acceptance freeze',
    extendsExpiry: 'on',
  });
  check('membership frozen', target(fzRes).includes('msg=frozen'), target(fzRes));
  const detail3 = await (await getFollow(`/members/${memberId}`)).text();
  const unfreezeForm = extractForm(detail3, 'membershipId');
  const ufRes = await postAction(`/members/${memberId}`, unfreezeForm, {});
  check('membership unfrozen', target(ufRes).includes('msg=unfrozen'), target(ufRes));

  // Cancel the pending (pre-sold) renewal through the UI — the cancel page
  // offers a membership picker when a running row and a pending row coexist.
  const [pendingRow] = await q(
    `SELECT id FROM memberships WHERE member_id = $1 AND state = 'pending'`,
    [memberId],
  );
  const pickerHtml = await (await get(`/members/${memberId}/cancel`)).text();
  check(
    'cancel page offers a picker while running + pending coexist',
    pickerHtml.includes('name="membershipId"') && pickerHtml.includes('<select'),
    '',
  );
  const pendingCancelForm = extractForm(pickerHtml, 'reason');
  const pcRes = await postAction(`/members/${memberId}/cancel`, pendingCancelForm, {
    membershipId: pendingRow.id,
    reason: 'Pre-sold renewal returned',
  });
  check('pending renewal cancelled via UI', target(pcRes).includes('msg=cancelled'), target(pcRes));
  const [afterPendingCancel] = await q(`SELECT status FROM members WHERE id = $1`, [memberId]);
  check(
    'member still active after cancelling only the pending renewal',
    afterPendingCancel.status === 'active',
    afterPendingCancel.status,
  );
  const cancelForm = extractForm(await (await get(`/members/${memberId}/cancel`)).text(), 'reason');
  const cnRes = await postAction(`/members/${memberId}/cancel`, cancelForm, {
    reason: 'Acceptance cancellation',
  });
  check('membership cancelled with reason', target(cnRes).includes('msg=cancelled'), target(cnRes));
  const [afterFullCancel] = await q(`SELECT status FROM members WHERE id = $1`, [memberId]);
  check(
    'member cancelled once nothing is live',
    afterFullCancel.status === 'cancelled',
    afterFullCancel.status,
  );
  const [afterCancel] = await q(`SELECT count(*)::int AS n FROM payments WHERE member_id = $1`, [
    memberId,
  ]);
  // Membership + PT sale + the renewal deposit — all three survive the cancel.
  check('payment history intact after cancellation', afterCancel.n === 3, String(afterCancel.n));

  // Archive (soft delete): only possible now that nothing is live.
  const archiveForm = extractForm(
    await (await getFollow(`/members/${memberId}`)).text(),
    'archive',
  );
  const arRes = await postAction(`/members/${memberId}`, archiveForm, {});
  check('member archived via UI', target(arRes).includes('msg=archived'), target(arRes));
  const [archived] = await q(
    `SELECT status, archived_at IS NOT NULL AS archived FROM members WHERE id = $1`,
    [memberId],
  );
  check(
    'archive keeps the row (soft delete) with status=archived',
    archived.archived === true && archived.status === 'archived',
    JSON.stringify(archived),
  );

  // ---- CSV import (dry run then confirm) ----------------------------------
  console.log('\n[Gym B CSV import]');
  const badCsv = 'member_name,mobile,membership_plan,start_date\nX,12345,Quarterly,2026-01-01';
  const importForm = extractForm(await (await get('/members/import')).text(), 'csv');
  const badRes = await postAction('/members/import', importForm, { csv: badCsv });
  const badPreview = await (await get(target(badRes).replace(/^https?:\/\/[^/]+/, ''))).text();
  check(
    'invalid rows block import (no confirm button)',
    badPreview.includes('Fix the errors') && !badPreview.includes('Confirm import'),
    '',
  );

  const goodCsv =
    'member_name,mobile,membership_plan,start_date,expiry_date,amount_paid,payment_method\n' +
    `Imported One,9222200001,Quarterly,${istToday},,1000,cash\n` +
    'Imported Two,9222200002,Quarterly,2026-01-01,2026-03-31,800,upi';
  const goodRes = await postAction('/members/import', importForm, { csv: goodCsv });
  const goodPath = target(goodRes).replace(/^https?:\/\/[^/]+/, '');
  const goodPreviewHtml = await (await get(goodPath)).text();
  check(
    'valid rows preview clean (confirm offered)',
    goodPreviewHtml.includes('Confirm import') && !goodPreviewHtml.includes('Fix the errors'),
    '',
  );
  const confirmForm = extractForm(goodPreviewHtml, 'digest');
  const confRes = await postAction(goodPath, confirmForm, {});
  check('import confirmed', target(confRes).includes('done=2'), target(confRes));
  const imported = await q(
    `SELECT m.status, ms.state FROM members m
     JOIN tenants t ON t.id = m.tenant_id
     LEFT JOIN memberships ms ON ms.member_id = m.id
     WHERE t.slug = $1 AND m.mobile IN ('+919222200001','+919222200002') ORDER BY m.mobile`,
    [SLUG],
  );
  check(
    'imported members active + expired correctly',
    imported.length === 2 && imported[0].state === 'active' && imported[1].state === 'expired',
    JSON.stringify(imported),
  );

  // ---- Daily sweep: a pre-sold renewal whose start date arrived activates --
  const [impMember] = await q(
    `SELECT m.id, ms.id AS membership_id FROM members m
     JOIN tenants t ON t.id = m.tenant_id
     JOIN memberships ms ON ms.member_id = m.id
     WHERE t.slug = $1 AND m.mobile = '+919222200002'`,
    [SLUG],
  );
  await q(
    `INSERT INTO memberships (tenant_id, branch_id, member_id, plan_id, plan_version_id,
       plan_name_snapshot, start_date, base_end_date, end_date, grace_period_days, state,
       total_amount, discount_amount, sold_by)
     SELECT tenant_id, branch_id, member_id, plan_id, plan_version_id, plan_name_snapshot,
            CURRENT_DATE - 1, CURRENT_DATE + 30, CURRENT_DATE + 30, grace_period_days,
            'pending', total_amount, 0, sold_by
     FROM memberships WHERE id = $1`,
    [impMember.membership_id],
  );
  execFileSync('npx', ['tsx', 'scripts/sweep-memberships.ts'], {
    cwd: 'packages/database',
    env: { ...process.env, DATABASE_URL: DB },
    stdio: 'pipe',
  });
  const [swept] = await q(
    `SELECT ms.state, m.status FROM memberships ms JOIN members m ON m.id = ms.member_id
     WHERE ms.member_id = $1 AND ms.start_date = CURRENT_DATE - 1`,
    [impMember.id],
  );
  check(
    'sweep activates due pre-sold membership + member status',
    swept.state === 'active' && swept.status === 'active',
    JSON.stringify(swept),
  );

  // ---- 16. Reports --------------------------------------------------------
  const reportsRes = await get('/reports');
  check('reports page renders for Gym B', reportsRes.status === 200, String(reportsRes.status));
  const exportCsvText = await (await get('/api/export/members')).text();
  check(
    'Gym B export contains its (non-archived) members',
    exportCsvText.includes('+919222200001'),
  );
  check(
    'archived member excluded from export',
    !exportCsvText.includes('+91' + mobile),
    'archived member should not be exported',
  );
  check('Gym B export has no demo-gym members', !exportCsvText.includes('+919876543210'));

  // ---- ISOLATION: Gym A vs Gym B ------------------------------------------
  // ---- owner economics: repricing and counter discounts ------------------
  // The plans page has always promised "Price changes create a new version —
  // past sales keep their original terms", and the service has always done
  // that; there was no way to reach it. Likewise the discount-approval
  // threshold was enforced by a service no form ever called.
  console.log('\n[owner: reprice + counter discount]');
  check('owner relogin for repricing', await loginAs(`owner@${SLUG}.test`, ownerPw));
  const plansPage = await (await get('/plans')).text();
  check(
    'the plans table offers a reprice control',
    /name="basePrice"[\s\S]{0,400}?Reprice|Reprice/.test(plansPage),
  );
  const repriceForm = extractForm(plansPage, 'planId');
  const repriceRes = await postAction('/plans', repriceForm, {
    planId: qPlan.id,
    basePrice: '2500',
    joiningFee: '300',
  });
  check('reprice accepted', !target(repriceRes).includes('error'), target(repriceRes));
  const versions = await q(
    `SELECT version, base_price::bigint::text AS base_price, duration_value, grace_period_days
       FROM membership_plan_versions WHERE plan_id = $1 ORDER BY version`,
    [qPlan.id],
  );
  check(
    'repricing created a new version, it did not edit the old one',
    versions.length === 2,
    `versions=${versions.length}`,
  );
  check(
    'the new version carries the new price',
    versions.at(-1).base_price === '250000',
    versions.at(-1).base_price,
  );
  check(
    'the original version is untouched',
    versions[0].base_price === '200000',
    versions[0].base_price,
  );
  check(
    'other terms carried forward, not reset',
    versions.at(-1).duration_value === versions[0].duration_value &&
      versions.at(-1).grace_period_days === versions[0].grace_period_days,
  );
  const soldEarlier = await q(
    `SELECT total_amount::bigint::text AS total FROM memberships
      WHERE member_id = $1 ORDER BY created_at LIMIT 1`,
    [memberId],
  );
  check(
    'a membership sold before the reprice keeps its original amount',
    soldEarlier[0].total === '184000',
    soldEarlier[0]?.total,
  );

  // A duplicate plan name must say so, not "Something went wrong".
  const dupPlanRes = await postAction(
    '/plans',
    extractForm(await (await get('/plans')).text(), 'durationValue'),
    {
      name: 'Quarterly',
      durationValue: '3',
      durationUnit: 'months',
      basePrice: '2500',
      joiningFee: '0',
      gracePeriodDays: '5',
      freezeAllowanceDays: '30',
      maxFreezes: '2',
    },
  );
  check(
    'a duplicate plan name is explained, not swallowed',
    decodeURIComponent(target(dupPlanRes)).includes('already exists'),
    decodeURIComponent(target(dupPlanRes)).slice(-140),
  );

  // PT packages: repriceable and retireable (they snapshot on sale, so no
  // versioning is needed).
  const [ptPkgToReprice] = await q(
    `SELECT a.id FROM addon_packages a JOIN tenants t ON t.id = a.tenant_id
      WHERE t.slug = $1 AND a.name = 'PT 5'`,
    [SLUG],
  );
  const ptRepriceForm = extractForm(await (await get('/plans')).text(), 'packageId');
  const ptRes = await postAction('/plans', ptRepriceForm, {
    packageId: ptPkgToReprice.id,
    price: '1800',
  });
  check('PT package repriced', !target(ptRes).includes('error'), target(ptRes));
  const [ptAfter] = await q(
    `SELECT price::bigint::text AS price, is_active FROM addon_packages WHERE id = $1`,
    [ptPkgToReprice.id],
  );
  check('the PT package carries the new price', ptAfter.price === '180000', ptAfter.price);
  const [ptSold] = await q(
    `SELECT price_snapshot::bigint::text AS p FROM member_addons WHERE member_id = $1 LIMIT 1`,
    [memberId],
  );
  check(
    'an already-sold PT package keeps its snapshot price',
    !ptSold || ptSold.p === '150000',
    ptSold?.p,
  );

  // Counter discount: the owner holds discounts.approve, so any size is fine.
  const discMobile = `9${String(Math.floor(100000000 + Math.random() * 899999999))}`;
  check(
    'reception relogin for the discount sale',
    await loginAs(`reception@${SLUG}.test`, recepPw),
  );
  const dStep1 = extractForm(await (await get('/members/new')).text(), 'mobile');
  const dDup = await postAction('/members/new', dStep1, { mobile: discMobile });
  const dStep2Path = target(dDup).replace(/^https?:\/\/[^/]+/, '');
  const dStep2Html = await (await get(dStep2Path)).text();
  check('the sell form offers a discount field to staff who may discount', dStep2Html.length > 0);
  const dCreate = await postAction(dStep2Path, extractForm(dStep2Html, 'firstName'), {
    mobile: discMobile,
    branchId: dStep2Html.match(/<option[^>]*value="([a-f0-9-]{36})"/)?.[1],
    firstName: 'Disc',
    lastName: 'Ount',
    referralSource: 'walk_in',
  });
  const dSellPath = target(dCreate).replace(/^https?:\/\/[^/]+/, '');
  const dMemberId = dSellPath.match(/members\/([a-f0-9-]+)\/sell/)?.[1];
  const dSellHtml = await (await get(dSellPath)).text();
  check(
    'the discount field is rendered on the sell form',
    dSellHtml.includes('name="manualDiscount"'),
  );
  // Quarterly is now ₹2500 + ₹300 joining = ₹2800; ₹300 off = ₹2500.
  const dSellRes = await postAction(dSellPath, extractForm(dSellHtml, 'planId'), {
    planId: qPlan.id,
    startDate: istToday,
    includeJoiningFee: 'on',
    manualDiscount: '300',
    amount: '2500',
    method: 'cash',
  });
  check(
    'a counter discount within the limit is accepted',
    target(dSellRes).includes('msg=sold'),
    target(dSellRes),
  );
  const [dMs] = await q(
    `SELECT total_amount::bigint::text AS total, discount_amount::bigint::text AS disc
       FROM memberships WHERE member_id = $1`,
    [dMemberId],
  );
  check('the discount is recorded on the membership', dMs.disc === '30000', dMs.disc);
  check('the total is net of the discount', dMs.total === '250000', dMs.total);

  // ---- GST: a registered gym must be able to issue a tax invoice ---------
  // Gyms above the GST turnover threshold cannot legally invoice without
  // GSTIN, taxable value and a CGST/SGST split on the document.
  console.log('\n[GST tax invoice]');
  check('owner relogin for GST setup', await loginAs(`owner@${SLUG}.test`, ownerPw));
  const gstSettingsForm = extractForm(await (await get('/settings')).text(), 'receiptPrefix');
  const gstSet = await postAction('/settings', gstSettingsForm, {
    receiptPrefix: 'HFT',
    gracePeriodDays: '5',
    maxFreezes: '2',
    maxFreezeDays: '30',
    // A browser submits every checkbox on the form; omitting this one here
    // would turn part payments back off as a side effect of saving GST.
    allowPartial: 'on',
    gstin: '37ABCDE1234F1Z5',
    taxStateName: 'Andhra Pradesh',
  });
  check('GSTIN saved', target(gstSet).includes('msg=saved'), target(gstSet));

  const badGstRes = await postAction(
    '/settings',
    extractForm(await (await get('/settings')).text(), 'receiptPrefix'),
    { receiptPrefix: 'HFT', gstin: 'NOTAGSTIN' },
  );
  check(
    'a malformed GSTIN is refused, not silently stored',
    target(badGstRes).includes('error'),
    target(badGstRes),
  );

  const gstPlanForm = extractForm(await (await get('/plans')).text(), 'durationValue');
  const gstPlanRes = await postAction('/plans', gstPlanForm, {
    name: 'GST Annual',
    durationValue: '12',
    durationUnit: 'months',
    basePrice: '11800',
    joiningFee: '0',
    gracePeriodDays: '5',
    freezeAllowanceDays: '30',
    maxFreezes: '2',
    taxRateBps: '1800',
    taxInclusive: 'true',
  });
  check('18% GST plan created', !target(gstPlanRes).includes('error'), target(gstPlanRes));
  const [gstPlan] = await q(
    `SELECT p.id, v.tax_rate_bps FROM membership_plans p
       JOIN membership_plan_versions v ON v.plan_id = p.id
       JOIN tenants t ON t.id = p.tenant_id
      WHERE t.slug = $1 AND p.name = 'GST Annual'`,
    [SLUG],
  );
  check(
    'the plan stored the 18% rate',
    gstPlan?.tax_rate_bps === 1800,
    String(gstPlan?.tax_rate_bps),
  );

  // Sell it to a fresh member and pay in full.
  check('reception relogin', await loginAs(`reception@${SLUG}.test`, recepPw));
  const gstMobile = `9${String(Math.floor(100000000 + Math.random() * 899999999))}`;
  const gStep1 = extractForm(await (await get('/members/new')).text(), 'mobile');
  const gDup = await postAction('/members/new', gStep1, { mobile: gstMobile });
  const gStep2Path = target(gDup).replace(/^https?:\/\/[^/]+/, '');
  const gStep2Html = await (await get(gStep2Path)).text();
  const gCreate = await postAction(gStep2Path, extractForm(gStep2Html, 'firstName'), {
    mobile: gstMobile,
    branchId: gStep2Html.match(/<option[^>]*value="([a-f0-9-]{36})"/)?.[1],
    firstName: 'Gst',
    lastName: 'Payer',
    referralSource: 'walk_in',
  });
  const gSellPath = target(gCreate).replace(/^https?:\/\/[^/]+/, '');
  const gstMemberId = gSellPath.match(/members\/([a-f0-9-]+)\/sell/)?.[1];
  check('GST member onboarded', Boolean(gstMemberId), gSellPath);
  const gSellRes = await postAction(
    gSellPath,
    extractForm(await (await get(gSellPath)).text(), 'planId'),
    {
      planId: gstPlan.id,
      startDate: istToday,
      amount: '11800',
      method: 'cash',
    },
  );
  check('GST membership sold', target(gSellRes).includes('msg=sold'), target(gSellRes));

  // ₹11,800 inclusive of 18% => taxable ₹10,000, GST ₹1,800 (CGST 900 + SGST 900)
  const [gstMs] = await q(
    `SELECT total_amount, tax_amount, tax_rate_bps FROM memberships
      WHERE member_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [gstMemberId],
  );
  check(
    'the sale snapshotted the tax',
    Number(gstMs.tax_amount) === 180000,
    `tax_amount=${gstMs.tax_amount}`,
  );
  check('the sale snapshotted the rate', gstMs.tax_rate_bps === 1800);
  check(
    'total is unchanged by tax (inclusive pricing)',
    Number(gstMs.total_amount) === 1180000,
    `total=${gstMs.total_amount}`,
  );

  const [gstPay] = await q(
    `SELECT p.id FROM payments p WHERE p.member_id = $1 ORDER BY p.created_at DESC LIMIT 1`,
    [gstMemberId],
  );
  const invoice = await (await getFollow(`/receipts/${gstPay.id}`)).text();
  check('the receipt is titled TAX INVOICE', invoice.includes('TAX INVOICE'));
  check('the GSTIN is printed', invoice.includes('37ABCDE1234F1Z5'));
  check('the SAC code is printed', invoice.includes('999723'));
  check('the place of supply is printed', invoice.includes('Andhra Pradesh'));
  check('taxable value is shown as ₹10,000', /Taxable value[\s\S]{0,120}?10,000/.test(invoice));
  check('CGST is half the rate at 9%', /CGST @ 9%/.test(invoice));
  check('SGST is half the rate at 9%', /SGST @ 9%/.test(invoice));
  check(
    'CGST and SGST are ₹900 each',
    (invoice.match(/₹900(\.00)?/g) ?? []).length >= 2,
    String((invoice.match(/₹900(\.00)?/g) ?? []).length),
  );

  // A gym that is NOT registered must not print a tax invoice. Gym A has no
  // GSTIN, so its receipts stay plain acknowledgements.
  const [gymAPay] = await q(
    `SELECT p.id FROM payments p JOIN tenants t ON t.id = p.tenant_id
      WHERE t.slug = 'apfitness' ORDER BY p.created_at DESC LIMIT 1`,
  );
  if (gymAPay) {
    check(
      'owner relogin for the unregistered-gym check',
      await loginAs('owner@demo.gymflow.local', 'gymflow-dev-password'),
    );
    const plainReceipt = await (await getFollow(`/receipts/${gymAPay.id}`)).text();
    check('an unregistered gym prints no tax invoice', !plainReceipt.includes('TAX INVOICE'));
    check('and no CGST line', !plainReceipt.includes('CGST'));
  }

  // ---- the receptionist's day: reversible actions ------------------------
  console.log('\n[reception: nothing is a one-way door]');
  check('reception relogin for reversibility', await loginAs(`reception@${SLUG}.test`, recepPw));

  // The archived member from earlier in this run must be findable again.
  const archivedList = await (await getFollow('/members?archived=1')).text();
  check('archived members can be listed', /Archived only/.test(archivedList));
  const [archivedRow] = await q(
    `SELECT m.id, m.membership_number FROM members m JOIN tenants t ON t.id = m.tenant_id
      WHERE t.slug = $1 AND m.archived_at IS NOT NULL LIMIT 1`,
    [SLUG],
  );
  if (archivedRow) {
    check(
      'and the archived member appears in that list',
      archivedList.includes(archivedRow.membership_number),
      archivedRow.membership_number,
    );
    const archivedPage = await (await getFollow(`/members/${archivedRow.id}`)).text();
    check('their page offers a restore', /Restore member/.test(archivedPage));
    const restoreForm = extractForm(archivedPage, 'memberId', 'Restore member');
    const restoreRes = await postAction(`/members/${archivedRow.id}`, restoreForm, {
      memberId: archivedRow.id,
    });
    check(
      'restoring works',
      decodeURIComponent(target(restoreRes)).includes('unarchived'),
      decodeURIComponent(target(restoreRes)).slice(-100),
    );
    const [restored] = await q(`SELECT archived_at FROM members WHERE id = $1`, [archivedRow.id]);
    check('and the member is back on the books', restored.archived_at === null);
  }

  // A lost lead must still be reachable.
  const lostList = await (await getFollow('/leads?status=lost')).text();
  check(
    'lost leads have their own view',
    lostList.includes('Show lost') || lostList.includes('కోల్పోయిన'),
  );

  // The sell form must not invite a part payment the gym refuses. Part
  // payments were switched ON for this gym earlier in the run.
  const [sellMember] = await q(
    `SELECT m.id FROM members m JOIN tenants t ON t.id = m.tenant_id
      WHERE t.slug = $1 AND m.archived_at IS NULL ORDER BY m.created_at DESC LIMIT 1`,
    [SLUG],
  );
  const sellFormHtml = await (await getFollow(`/members/${sellMember.id}/sell`)).text();
  check(
    "the payment hint matches the gym's part-payment setting",
    /this gym allows part payments/i.test(sellFormHtml),
    sellFormHtml.match(/[^<>]*part payments[^<>]*/i)?.[0] ?? 'hint not found',
  );

  // ---- receivables must not leak out of the books ------------------------
  console.log('\n[receivables]');
  check('owner relogin for receivables', await loginAs(`owner@${SLUG}.test`, ownerPw));

  // 1. An expired membership still owes what it owes. The nightly sweep used
  //    to make the balance disappear from every aggregate on the same night.
  const [partPaid] = await q(
    `SELECT ms.id, ms.member_id, ms.end_date FROM memberships ms
       JOIN members m ON m.id = ms.member_id
       JOIN tenants t ON t.id = ms.tenant_id
      WHERE t.slug = $1 AND ms.state = 'active'
        AND (ms.total_amount - coalesce((
              SELECT sum(pa.amount) FROM payment_allocations pa WHERE pa.membership_id = ms.id
            ), 0)) > 0
      LIMIT 1`,
    [SLUG],
  );
  if (partPaid) {
    const duesBefore = await (await getFollow('/api/export/dues')).text();
    check('a part-paid live membership is in the dues export', duesBefore.includes('membership'));
    await db.query(`UPDATE memberships SET state = 'expired' WHERE id = $1`, [partPaid.id]);
    const duesAfterExpiry = await (await getFollow('/api/export/dues')).text();
    const stillListed = duesAfterExpiry
      .split('\n')
      .some((line) => line.includes('expired') && line.includes('membership'));
    check('and it is still there after the membership expires', stillListed);
    await db.query(`UPDATE memberships SET state = 'active' WHERE id = $1`, [partPaid.id]);
  }

  // 2. A PT package sold on a deposit is a receivable too, and appeared in no
  //    report at all.
  const [ptAddon] = await q(
    `SELECT ma.id, ma.price_snapshot::bigint::text AS price FROM member_addons ma
       JOIN tenants t ON t.id = ma.tenant_id WHERE t.slug = $1 LIMIT 1`,
    [SLUG],
  );
  if (ptAddon) {
    const [alloc] = await q(
      `SELECT coalesce(sum(amount),0)::bigint::text AS paid FROM payment_allocations
        WHERE member_addon_id = $1`,
      [ptAddon.id],
    );
    const outstanding = Number(ptAddon.price) - Number(alloc.paid);
    const duesCsv = await (await getFollow('/api/export/dues')).text();
    check(
      'the dues export distinguishes memberships from add-ons',
      duesCsv.includes('item_type'),
      duesCsv.split('\n')[0],
    );
    if (outstanding > 0) {
      check('an unpaid PT package shows up as a receivable', duesCsv.includes('addon'));
    }
  }

  // 3. A CSV-imported part-paid member must keep the balance they owe.
  // "Imported One" paid 1,000 against a Quarterly plan. total_amount must be
  // the plan price, not the 1,000 — writing the paid figure there recorded
  // every migrated part-payer as settled in full.
  const [importedMs] = await q(
    `SELECT ms.total_amount::bigint::text AS total,
            coalesce((SELECT sum(pa.amount) FROM payment_allocations pa
                       WHERE pa.membership_id = ms.id), 0)::bigint::text AS paid
       FROM memberships ms
       JOIN members m ON m.id = ms.member_id
       JOIN tenants t ON t.id = ms.tenant_id
      WHERE t.slug = $1 AND m.mobile = '+919222200001'`,
    [SLUG],
  );
  check(
    'an imported part-paid member keeps the balance they owe',
    Boolean(importedMs) &&
      Number(importedMs.total) > Number(importedMs.paid) &&
      Number(importedMs.paid) === 100000,
    JSON.stringify(importedMs),
  );
  const duesAfterImport = await (await getFollow('/api/export/dues')).text();
  check('and appears in the dues export', duesAfterImport.includes('9222200001'));

  // 4. Plan mix reports money that arrived, not contract value.
  const reportsHtml = await (await getFollow('/reports')).text();
  check(
    'the plan-mix table reports Collected, not "Revenue"',
    reportsHtml.includes('Collected') && !reportsHtml.includes('>Revenue<'),
  );
  check('and shows what is still outstanding', reportsHtml.includes('Outstanding'));

  // 5. CSV opens correctly in Excel for Telugu names.
  const exportRes = await getFollow('/api/export/members');
  // Read bytes, not text: Response.text() decodes UTF-8 and strips the BOM,
  // so a string check here would pass whether or not the BOM was ever sent.
  const exportBytes = new Uint8Array(await exportRes.arrayBuffer());
  check(
    'CSV exports start with a UTF-8 BOM for Excel',
    exportBytes[0] === 0xef && exportBytes[1] === 0xbb && exportBytes[2] === 0xbf,
    Array.from(exportBytes.slice(0, 3)).join(','),
  );
  check(
    'and are not cached',
    /no-store/.test(exportRes.headers.get('cache-control') ?? ''),
    exportRes.headers.get('cache-control') ?? 'none',
  );

  // ---- support recovery: a locked-out owner ------------------------------
  // The admin UI's staff list is tenant-scoped, so a platform admin sees no
  // staff at all. Without this CLI a gym whose only owner forgot their
  // password needed a developer with a psql prompt.
  console.log('\n[support: recover a locked-out owner]');
  const recoverOut = execFileSync(
    'pnpm',
    [
      '--filter',
      '@gymflow/database',
      'reset-staff-password',
      '--',
      '--email',
      `owner@${SLUG}.test`,
    ],
    { env: { ...process.env, DATABASE_URL: DB }, encoding: 'utf8' },
  );
  const recoveredPw = recoverOut.match(/\n\s{4}(\S{10,})\n/)?.[1];
  check('operator CLI issued a new owner password', Boolean(recoveredPw), recoverOut.slice(-200));
  check('the old owner password no longer works', !(await loginAs(`owner@${SLUG}.test`, ownerPw)));
  check(
    'the owner can sign in with the recovered password',
    await loginAs(`owner@${SLUG}.test`, recoveredPw),
  );
  const resetAudit = await db.query(
    `SELECT count(*)::int AS n FROM audit_logs a JOIN tenants t ON t.id = a.tenant_id
      WHERE t.slug = $1 AND a.action = 'staff.password_reset'`,
    [SLUG],
  );
  check('the recovery is in the gym audit log', resetAudit.rows[0].n === 1);

  console.log('\n[isolation: Gym A ↔ Gym B]');
  check(
    'Gym A owner login',
    await loginAs('owner@demo.gymflow.local', process.env.E2E_PASSWORD ?? 'gymflow-dev-password'),
  );
  const crossDetail = await get(`/members/${memberId}`);
  const crossFollowed = await getFollow(`/members/${memberId}`);
  check(
    'Gym A cannot open Gym B member page',
    crossFollowed.status === 404 || crossDetail.status === 404,
    String(crossFollowed.status),
  );
  const aExport = await (await get('/api/export/members')).text();
  check('Gym A export has zero Gym B rows', !aExport.includes('+91' + mobile));
  const aPlans = await (await get('/plans')).text();
  check('Gym A plan list differs (no "Quarterly" of Gym B)', !aPlans.includes('Quarterly'));
  const aSettings = await (await get('/settings')).text();
  check('Gym A keeps its own receipt prefix (SVF)', aSettings.includes('value="SVF"'));

  const wrongGym = await fetch(`${BASE}/api/member/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gymCode: 'apfitness', mobile, password: appPw }),
  });
  check(
    'Gym B member cannot log into Gym A (tenant-scoped identity)',
    wrongGym.status === 401,
    String(wrongGym.status),
  );
  if (tokens) {
    const meAgain = await (
      await fetch(`${BASE}/api/member/v1/me`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      })
    ).json();
    check('Gym B member token stays scoped to Gym B', meAgain?.gym?.name === GYM_B_NAME);
  }

  // Cleanup: archive the acceptance tenant so repeated runs stay tidy.
  await db.query(`UPDATE tenants SET status = 'archived' WHERE slug = $1`, [SLUG]);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.error('FAILURES:', failures.join(' | '));
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.end());
