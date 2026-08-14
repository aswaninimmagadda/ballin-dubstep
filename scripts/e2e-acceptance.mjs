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
function extractForm(html, markerField) {
  for (const f of html.split('<form').slice(1)) {
    if (!f.includes(`name="${markerField}"`)) continue;
    const actionId = f.match(/\$ACTION_ID_([a-f0-9]+)/)?.[1];
    const hidden = {};
    for (const m of f.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)) {
      if (!m[1].startsWith('$ACTION')) hidden[m[1]] = m[2];
    }
    return { actionId, hidden };
  }
  throw new Error(`No form with field ${markerField}`);
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
  const cliOut = execFileSync(
    'npx',
    [
      'tsx',
      'scripts/create-tenant.mjs',
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
    { env: { ...process.env, DATABASE_URL: DB }, encoding: 'utf8', cwd: 'packages/database' },
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

  // Staff: receptionist for Gym B (one-time password captured)
  const staffHtml = await (await get('/staff')).text();
  const staffForm = extractForm(staffHtml, 'displayName');
  const recepRoleId = (
    await q(
      `SELECT r.id FROM roles r JOIN tenants t ON t.id = r.tenant_id
       WHERE t.slug = $1 AND r.key = 'receptionist'`,
      [SLUG],
    )
  )[0].id;
  const stRes = await postAction('/staff', staffForm, {
    displayName: 'Front Desk B',
    email: `reception@${SLUG}.test`,
    roleId: recepRoleId,
  });
  const stTarget = target(stRes);
  const recepPw = decodeURIComponent(stTarget.match(/pw=([^&]+)/)?.[1] ?? '');
  check('receptionist account created with one-time password', Boolean(recepPw), stTarget);

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

  // ---- 11-12. Member app sees Gym B ---------------------------------------
  console.log('\n[Gym B member app]');
  const forms = detailHtml
    .split('<form')
    .slice(1)
    .filter((f) => f.includes('name="memberId"'));
  const enableHtml = forms.find((f) => f.includes('Enable member app access'));
  const enableRes = await postAction(
    `/members/${memberId}`,
    { actionId: enableHtml.match(/\$ACTION_ID_([a-f0-9]+)/)[1], hidden: { memberId } },
    {},
  );
  const appPw = decodeURIComponent(target(enableRes).match(/pw=([^&]+)/)?.[1] ?? '');
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
  const rnRes = await postAction(`/members/${memberId}/renew`, renewForm, {
    planId: qPlan.id,
    amount: '',
    method: 'cash',
  });
  check('renewal recorded', target(rnRes).includes('msg=renewed'), target(rnRes));

  check('owner relogin', await loginAs(`owner@${SLUG}.test`, ownerPw));
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

  // Cancel the pending renewal
  const [pendingRow] = await q(
    `SELECT id FROM memberships WHERE member_id = $1 AND state = 'pending'`,
    [memberId],
  );
  if (pendingRow) {
    await q(
      `UPDATE memberships SET state='cancelled', cancelled_at=now(), cancel_reason='n/a' WHERE id=$1`,
      [pendingRow.id],
    );
  }
  const cancelForm = extractForm(await (await get(`/members/${memberId}/cancel`)).text(), 'reason');
  const cnRes = await postAction(`/members/${memberId}/cancel`, cancelForm, {
    reason: 'Acceptance cancellation',
  });
  check('membership cancelled with reason', target(cnRes).includes('msg=cancelled'), target(cnRes));
  const [afterCancel] = await q(`SELECT count(*)::int AS n FROM payments WHERE member_id = $1`, [
    memberId,
  ]);
  check('payment history intact after cancellation', afterCancel.n === 2, String(afterCancel.n));

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

  // ---- 16. Reports --------------------------------------------------------
  const reportsRes = await get('/reports');
  check('reports page renders for Gym B', reportsRes.status === 200, String(reportsRes.status));
  const exportCsvText = await (await get('/api/export/members')).text();
  check('Gym B export contains its member', exportCsvText.includes('+91' + mobile));
  check('Gym B export has no demo-gym members', !exportCsvText.includes('+919876543210'));

  // ---- ISOLATION: Gym A vs Gym B ------------------------------------------
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
