#!/usr/bin/env node
/**
 * End-to-end test of the critical admin workflows over real HTTP against a
 * running admin server + seeded database (spec scenarios 1-3):
 *   1. New member: onboard → sell 3-month plan → cash payment → receipt
 *   2. Renewal: renew with promotion → UPI payment → chained membership
 *   3. Freeze: freeze 15 days → unfreeze → expiry extended
 *   plus reception check-in and duplicate-check-in guard.
 *
 * Usage: node scripts/e2e-admin.mjs [baseUrl]
 * Requires: admin server running, demo seed loaded, env DATABASE_URL for
 * verification queries.
 */
import pg from 'pg';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const DB =
  process.env.DATABASE_URL ?? 'postgres://gymflow:gymflow_dev_pw@localhost:5432/gymflow_dev';
const EMAIL = process.env.E2E_EMAIL ?? 'reception@demo.gymflow.local';
const PASSWORD = process.env.E2E_PASSWORD ?? 'gymflow-dev-password';

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
  const res = await fetch(BASE + path, { headers: { cookie }, redirect: 'manual' });
  return res;
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

/** Extract the server-action form containing `markerField` from page HTML. */
function extractForm(html, markerField) {
  const forms = html.split('<form').slice(1);
  for (const f of forms) {
    if (!f.includes(`name="${markerField}"`)) continue;
    const actionId = f.match(/\$ACTION_ID_([a-f0-9]+)/)?.[1];
    const hidden = {};
    for (const m of f.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)) {
      if (!m[1].startsWith('$ACTION')) hidden[m[1]] = m[2];
    }
    return { actionId, hidden };
  }
  throw new Error(`No form with field ${markerField} found`);
}

/** Post a server action form (progressive enhancement path). */
async function postAction(path, form, fields) {
  const fd = new FormData();
  fd.set(`$ACTION_ID_${form.actionId}`, '');
  for (const [k, v] of Object.entries({ ...form.hidden, ...fields })) fd.set(k, v);
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { cookie },
    body: fd,
    redirect: 'manual',
  });
  return res;
}

function redirectTarget(res) {
  // Server actions surface redirects via x-action-redirect (303) or location.
  return res.headers.get('x-action-redirect') ?? res.headers.get('location') ?? '';
}

async function q(sql, params = []) {
  const r = await db.query(sql, params);
  return r.rows;
}

async function loginAs(email, password = PASSWORD) {
  cookie = '';
  const loginPage = await (await get('/login')).text();
  const loginForm = extractForm(loginPage, 'email');
  const loginRes = await postAction('/login', loginForm, { email, password });
  const setCookie = loginRes.headers.get('set-cookie') ?? '';
  cookie = setCookie.split(';')[0];
  return cookie.startsWith('gymflow_session=');
}

async function main() {
  await db.connect();
  console.log(`E2E against ${BASE}`);

  // ---- login ---------------------------------------------------------------
  console.log('\n[login]');
  check('staff login sets a session cookie', await loginAs(EMAIL));

  // ---- scenario 1: new member + sale + payment + receipt -------------------
  console.log('\n[scenario 1 — new member]');
  const mobile = `9${String(Math.floor(100000000 + Math.random() * 899999999))}`;
  const step1 = await get('/members/new');
  const step1Form = extractForm(await step1.text(), 'mobile');
  const dupRes = await postAction('/members/new', step1Form, { mobile });
  const step2Path = redirectTarget(dupRes).replace(/^https?:\/\/[^/]+/, '');
  check('mobile passes duplicate check', step2Path.includes('step=2'), step2Path);

  const step2Html = await (await get(step2Path)).text();
  const createForm = extractForm(step2Html, 'firstName');
  const branchId =
    step2Html.match(/name="branchId"[^>]*>\s*<option[^>]*value="([a-f0-9-]+)"/)?.[1] ??
    step2Html.match(/<option[^>]*value="([a-f0-9-]{36})"/)?.[1];
  const createRes = await postAction(step2Path, createForm, {
    mobile,
    branchId,
    firstName: 'TestE2E',
    lastName: 'Person',
    referralSource: 'walk_in',
  });
  const sellPath = redirectTarget(createRes).replace(/^https?:\/\/[^/]+/, '');
  check(
    'member created → redirected to sell',
    /\/members\/[a-f0-9-]+\/sell/.test(sellPath),
    sellPath,
  );
  const memberId = sellPath.match(/members\/([a-f0-9-]+)\/sell/)?.[1];

  const [memberRow] = await q(`SELECT membership_number, status FROM members WHERE id = $1`, [
    memberId,
  ]);
  check(
    'member row exists with generated number',
    !!memberRow?.membership_number,
    JSON.stringify(memberRow),
  );

  const sellHtml = await (await get(sellPath)).text();
  const sellForm = extractForm(sellHtml, 'planId');
  const [plan3m] = await q(
    `SELECT p.id FROM membership_plans p JOIN members m ON m.tenant_id = p.tenant_id
     WHERE m.id = $1 AND p.name = '3 Month'`,
    [memberId],
  );
  const today = new Date().toISOString().slice(0, 10);
  const sellRes = await postAction(sellPath, sellForm, {
    planId: plan3m.id,
    startDate: today,
    includeJoiningFee: 'on',
    amount: '3000',
    method: 'cash',
  });
  check(
    'sale redirects to member page',
    redirectTarget(sellRes).includes('msg=sold'),
    redirectTarget(sellRes),
  );

  const [ms] = await q(
    `SELECT state, start_date::text AS s, end_date::text AS e, total_amount::bigint AS total
     FROM memberships WHERE member_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [memberId],
  );
  check('membership active', ms?.state === 'active', JSON.stringify(ms));
  const expectedEnd = new Date(
    Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1 + 3, +today.slice(8, 10)) - 86400000,
  )
    .toISOString()
    .slice(0, 10);
  check(`expiry = start + 3 months - 1 day (${expectedEnd})`, ms?.e === expectedEnd, ms?.e);
  check('total = ₹3000 (2500 + 500 joining)', Number(ms?.total) === 300000, String(ms?.total));

  const [pay] = await q(
    `SELECT p.amount::bigint AS amount, p.method, r.receipt_number
     FROM payments p LEFT JOIN receipts r ON r.payment_id = p.id
     WHERE p.member_id = $1`,
    [memberId],
  );
  check(
    'cash payment recorded',
    pay?.method === 'cash' && Number(pay.amount) === 300000,
    JSON.stringify(pay),
  );
  check(
    'receipt generated with tenant prefix',
    /^SVF-\d{4}-\d{6}$/.test(pay?.receipt_number ?? ''),
    pay?.receipt_number,
  );

  // ---- check-in + duplicate guard -----------------------------------------
  console.log('\n[check-in]');
  const detailHtml = await (await getFollow(`/members/${memberId}`)).text();
  const checkinForm = extractForm(detailHtml, 'memberId');
  const ck1 = await postAction(`/members/${memberId}`, checkinForm, {});
  check('first check-in ok', redirectTarget(ck1).includes('msg=checkedin'), redirectTarget(ck1));
  const ck2 = await postAction(`/members/${memberId}`, checkinForm, {});
  check(
    'duplicate check-in blocked',
    redirectTarget(ck2).includes('msg=duplicate'),
    redirectTarget(ck2),
  );
  const att = await q(`SELECT count(*)::int AS n FROM attendance WHERE member_id = $1`, [memberId]);
  check('exactly one attendance row', att[0].n === 1, String(att[0].n));

  // ---- scenario 2: renewal with promotion + UPI ---------------------------
  // ---- PT add-on (scenario 1 continues: "adds PT") ------------------------
  console.log('\n[PT add-on]');
  const addonHtml = await (await get(`/members/${memberId}/addon`)).text();
  const addonForm = extractForm(addonHtml, 'addonPackageId');
  const [pt8] = await q(
    `SELECT ap.id FROM addon_packages ap JOIN members m ON m.tenant_id = ap.tenant_id
     WHERE m.id = $1 AND ap.name = 'PT 8 Sessions'`,
    [memberId],
  );
  const addonRes = await postAction(`/members/${memberId}/addon`, addonForm, {
    addonPackageId: pt8.id,
    trainerId: '',
    amount: '2000',
    method: 'cash',
  });
  check(
    'PT package sold',
    redirectTarget(addonRes).includes('msg=addon'),
    redirectTarget(addonRes),
  );
  const [addonRow] = await q(
    `SELECT name_snapshot, sessions_total, price_snapshot::bigint AS price, state
     FROM member_addons WHERE member_id = $1`,
    [memberId],
  );
  check(
    'PT 8 sessions active with snapshot price',
    addonRow?.name_snapshot === 'PT 8 Sessions' &&
      addonRow.sessions_total === 8 &&
      Number(addonRow.price) === 200000 &&
      addonRow.state === 'active',
    JSON.stringify(addonRow),
  );
  const receiptsNow = await q(
    `SELECT count(*)::int AS n FROM receipts r JOIN payments p ON p.id = r.payment_id
     WHERE p.member_id = $1`,
    [memberId],
  );
  check(
    'second receipt issued for the PT payment',
    receiptsNow[0].n === 2,
    String(receiptsNow[0].n),
  );
  const notifs = await q(
    `SELECT count(*)::int AS n FROM notification_deliveries
     WHERE member_id = $1 AND channel = 'in_app' AND event = 'payment_received'`,
    [memberId],
  );
  check('in-app payment notification queued', notifs[0].n >= 1, String(notifs[0].n));

  // ---- member app activation ----------------------------------------------
  console.log('\n[member app access]');
  const detailForApp = await (await getFollow(`/members/${memberId}`)).text();
  check('enable-app form rendered', detailForApp.includes('name="kind" value="member_app"'));
  const credFd = new FormData();
  credFd.set('kind', 'member_app');
  credFd.set('memberId', memberId);
  const enableRes = await fetch(`${BASE}/credentials`, {
    method: 'POST',
    headers: { cookie },
    body: credFd,
  });
  const enableHtml = await enableRes.text();
  const appPw = enableHtml.match(/<code>([^<]+)<\/code>/)?.[1] ?? '';
  check(
    'member app enabled with one-time password (not in any URL)',
    enableRes.status === 200 && appPw.length >= 8,
    `${enableRes.status} pw:${appPw.length}`,
  );
  const [memberRowDb] = await q(`SELECT mobile, user_id FROM members WHERE id = $1`, [memberId]);
  check('member linked to a login user', Boolean(memberRowDb.user_id));

  // Member API login with the freshly issued credentials
  const apiLogin = await fetch(`${BASE}/api/member/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      gymCode: 'apfitness',
      mobile: memberRowDb.mobile.replace('+91', ''),
      password: appPw,
    }),
  });
  check('member can sign in to the app', apiLogin.status === 200, String(apiLogin.status));
  const tokens = apiLogin.status === 200 ? await apiLogin.json() : null;
  if (tokens) {
    const meRes = await fetch(`${BASE}/api/member/v1/me`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    const me = await meRes.json();
    check(
      'member app /me shows the sold membership',
      me?.membership?.planName === '3 Month',
      JSON.stringify(me?.membership ?? null),
    );
    const notifRes = await fetch(`${BASE}/api/member/v1/notifications`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    const notifBody = await notifRes.json();
    check(
      'member sees payment notifications in-app',
      Array.isArray(notifBody.notifications) && notifBody.notifications.length >= 1,
      JSON.stringify(notifBody).slice(0, 120),
    );
  }

  console.log('\n[scenario 2 — renewal]');
  const renewHtml = await (await get(`/members/${memberId}/renew`)).text();
  const renewForm = extractForm(renewHtml, 'previousMembershipId');
  const [plan6m] = await q(
    `SELECT p.id FROM membership_plans p JOIN members m ON m.tenant_id = p.tenant_id
     WHERE m.id = $1 AND p.name = '6 Month'`,
    [memberId],
  );
  const renewRes = await postAction(`/members/${memberId}/renew`, renewForm, {
    planId: plan6m.id,
    promotionCode: 'NEWYEAR26',
    amount: '4050',
    method: 'upi',
    externalReference: 'UTR-E2E-1',
  });
  check(
    'renewal succeeds',
    redirectTarget(renewRes).includes('msg=renewed'),
    redirectTarget(renewRes),
  );

  const renewals = await q(
    `SELECT state, previous_membership_id, total_amount::bigint AS total, discount_amount::bigint AS disc,
            start_date::text AS s, end_date::text AS e
     FROM memberships WHERE member_id = $1 ORDER BY created_at DESC`,
    [memberId],
  );
  const newest = renewals[0];
  check('renewal chained to previous membership', !!newest.previous_membership_id);
  check(
    '10% promo applied (₹4500 → ₹4050)',
    Number(newest.total) === 405000 && Number(newest.disc) === 45000,
    JSON.stringify({ total: newest.total, disc: newest.disc }),
  );
  check('renewal starts day after current expiry', newest.s > ms.e, `${newest.s} vs ${ms.e}`);
  const [redemption] = await q(
    `SELECT pr.discount_amount::bigint AS d FROM promotion_redemptions pr
     JOIN promotions p ON p.id = pr.promotion_id
     WHERE pr.member_id = $1 AND p.code = 'NEWYEAR26'`,
    [memberId],
  );
  check(
    'promotion redemption recorded',
    Number(redemption?.d) === 45000,
    JSON.stringify(redemption),
  );

  // Double-submit protection: replay the same renewal form (same idempotency key)
  const replay = await postAction(`/members/${memberId}/renew`, renewForm, {
    planId: plan6m.id,
    amount: '',
    method: 'upi',
  });
  const replayTarget = redirectTarget(replay);
  const count = await q(`SELECT count(*)::int AS n FROM memberships WHERE member_id = $1`, [
    memberId,
  ]);
  check(
    'double-click renewal does not create a third membership',
    count[0].n === 2,
    `${count[0].n} memberships, replay → ${replayTarget}`,
  );

  // Early renewal must not block entry: the RUNNING membership governs the
  // check-in gate, not the future-dated pending renewal.
  await q(`DELETE FROM attendance WHERE member_id = $1`, [memberId]);
  const gateForm = extractForm(await (await getFollow(`/members/${memberId}`)).text(), 'memberId');
  const gateRes = await postAction(`/members/${memberId}`, gateForm, {});
  check(
    'check-in still allowed after early renewal (running membership governs)',
    redirectTarget(gateRes).includes('msg=checkedin'),
    redirectTarget(gateRes),
  );

  // ---- scenario 3: freeze 15 days → unfreeze → expiry extended ------------
  console.log('\n[scenario 3 — freeze]');
  // Freezing needs memberships.freeze — a manager permission, not reception.
  const recepFreeze = await get(`/members/${memberId}/freeze`);
  check(
    'receptionist cannot open the freeze page',
    redirectTarget(recepFreeze).includes('/forbidden'),
    redirectTarget(recepFreeze),
  );
  check('manager login', await loginAs('manager@demo.gymflow.local'));
  const freezeHtml = await (await get(`/members/${memberId}/freeze`)).text();
  const freezeForm = extractForm(freezeHtml, 'reason');
  const fRes = await postAction(`/members/${memberId}/freeze`, freezeForm, {
    startDate: today,
    plannedEndDate: '',
    reason: 'E2E medical freeze',
    extendsExpiry: 'on',
  });
  check('freeze succeeds', redirectTarget(fRes).includes('msg=frozen'), redirectTarget(fRes));
  const [frozen] = await q(
    `SELECT id, state FROM memberships WHERE member_id = $1 AND state = 'frozen'`,
    [memberId],
  );
  check('the running membership is frozen (renewal stays pending)', !!frozen);

  // Backdate the freeze start 15 days so unfreeze today yields a 15-day
  // extension. Anchor on the app's IST calendar date, not Postgres
  // CURRENT_DATE (UTC) — they differ around IST midnight.
  const istToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  await db.query(
    `UPDATE membership_freezes SET start_date = $2::date - 15
     WHERE membership_id = $1 AND actual_end_date IS NULL`,
    [frozen.id, istToday],
  );

  const detail2 = await (await getFollow(`/members/${memberId}`)).text();
  const unfreezeForm = extractForm(detail2, 'membershipId');
  const uRes = await postAction(`/members/${memberId}`, unfreezeForm, {});
  check('unfreeze succeeds', redirectTarget(uRes).includes('msg=unfrozen'), redirectTarget(uRes));
  const [after] = await q(
    `SELECT state, end_date::text AS e, base_end_date::text AS b
     FROM memberships WHERE id = $1`,
    [frozen.id],
  );
  const extension = (new Date(after.e) - new Date(after.b)) / 86400000;
  check('membership active again', after.state === 'active');
  check('expiry extended by 15 frozen days', extension === 15, `extended ${extension} days`);

  // ---- unauthorized access -------------------------------------------------
  console.log('\n[authorization]');
  const savedCookie = cookie;
  cookie = '';
  const anon = await get(`/members/${memberId}`);
  check('member page requires login', [302, 303, 307].includes(anon.status), String(anon.status));
  const anonExport = await get('/api/export/members');
  check(
    'export API requires login',
    anon.status !== 200 && anonExport.status === 401,
    String(anonExport.status),
  );
  cookie = savedCookie;
  check('receptionist relogin', await loginAs(EMAIL));
  const recepAudit = await get('/audit');
  check(
    'receptionist blocked from audit log',
    redirectTarget(recepAudit).includes('/forbidden'),
    `${recepAudit.status} ${redirectTarget(recepAudit)}`,
  );

  // ---- refunds must come back off the money that was collected ------------
  // A mis-keyed amount can only be corrected by refunding, so a refund that
  // never reduces reported collections would leave the drawer unreconcilable.
  console.log('\n[refunds net out of collections]');
  check('owner login for refund', await loginAs('owner@demo.gymflow.local'));
  const [payRow] = await q(
    `SELECT p.id, p.amount::bigint AS amount FROM payments p
     WHERE p.member_id = $1 ORDER BY p.created_at DESC LIMIT 1`,
    [memberId],
  );
  const receiptHtml = await (await getFollow(`/receipts/${payRow.id}`)).text();
  const refundForm = extractForm(receiptHtml, 'paymentId');
  const refundRes = await postAction(`/receipts/${payRow.id}`, refundForm, {
    amount: '500',
    reason: 'E2E over-charge correction',
  });
  check(
    'refund recorded',
    !redirectTarget(refundRes).includes('error='),
    redirectTarget(refundRes),
  );

  const payCsv = await (await get('/api/export/payments')).text();
  const csvRow = payCsv.split('\n').find((l) => l.includes(String(payRow.amount)));
  check(
    'payments export shows the refund and the net',
    Boolean(csvRow) &&
      csvRow.split(',').includes('50000') &&
      csvRow.split(',').includes(String(Number(payRow.amount) - 50000)),
    csvRow ?? 'payment row missing from export',
  );

  const reportsHtml = await (await getFollow('/reports')).text();
  check('reports surface the refunded amount', reportsHtml.includes('refunded'), '');

  const [collected] = await q(
    `SELECT (SELECT coalesce(sum(amount),0) FROM payments WHERE status <> 'failed')::bigint AS gross,
            (SELECT coalesce(sum(amount),0) FROM refunds)::bigint AS refunded`,
  );
  check(
    'a refund exists to net out',
    Number(collected.refunded) >= 50000 && Number(collected.gross) > Number(collected.refunded),
    JSON.stringify(collected),
  );

  // ---- editing a member must actually save, including clearing a field ----
  console.log('\n[member edit clears fields]');
  check('receptionist relogin for edit', await loginAs(EMAIL));
  const editForm = extractForm(
    await (await getFollow(`/members/${memberId}/edit`)).text(),
    'firstName',
  );
  const [beforeEdit] = await q(`SELECT mobile, branch_id FROM members WHERE id = $1`, [memberId]);
  const setRes = await postAction(`/members/${memberId}/edit`, editForm, {
    memberId,
    branchId: beforeEdit.branch_id,
    firstName: 'TestE2E',
    lastName: 'Person',
    mobile: beforeEdit.mobile.replace('+91', ''),
    email: 'typo@example.com',
    village: 'Madanapalle',
    emergencyContactName: 'Relative',
    emergencyContactPhone: '08571-234567', // a landline: must be accepted
  });
  check('edit saved', redirectTarget(setRes).includes('msg=edited'), redirectTarget(setRes));
  const [afterSet] = await q(
    `SELECT email, village, emergency_contact_phone FROM members WHERE id = $1`,
    [memberId],
  );
  check(
    'landline accepted as an emergency contact',
    afterSet.emergency_contact_phone === '08571-234567',
    JSON.stringify(afterSet),
  );

  const clearRes = await postAction(`/members/${memberId}/edit`, editForm, {
    memberId,
    branchId: beforeEdit.branch_id,
    firstName: 'TestE2E',
    lastName: 'Person',
    mobile: beforeEdit.mobile.replace('+91', ''),
    email: '', // blanked on purpose — must be erased, not ignored
    village: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
  });
  check('clearing edit saved', redirectTarget(clearRes).includes('msg=edited'));
  const [afterClear] = await q(
    `SELECT email, village, emergency_contact_phone FROM members WHERE id = $1`,
    [memberId],
  );
  check(
    'blanked fields are actually cleared',
    afterClear.email === null &&
      afterClear.village === null &&
      afterClear.emergency_contact_phone === null,
    JSON.stringify(afterClear),
  );

  // ---- staff can rotate their own password --------------------------------
  // One-time passwords are handed over verbally at the desk; if the holder
  // can never change it, that credential is permanent.
  console.log('\n[self-service password change]');
  const NEW_PW = 'e2e-rotated-password-9';
  // Rotate the OWNER's password specifically — the block above signed in as
  // reception, and the assertions below are about the owner account.
  check('owner login before rotating', await loginAs('owner@demo.gymflow.local'));
  const pwForm = extractForm(
    await (await getFollow('/account/password')).text(),
    'currentPassword',
  );
  const wrongRes = await postAction('/account/password', pwForm, {
    currentPassword: 'definitely-not-the-password',
    newPassword: NEW_PW,
    confirmPassword: NEW_PW,
  });
  check(
    'wrong current password is refused',
    decodeURIComponent(redirectTarget(wrongRes)).includes('current password is not correct'),
    redirectTarget(wrongRes),
  );
  const pwRes = await postAction('/account/password', pwForm, {
    currentPassword: PASSWORD,
    newPassword: NEW_PW,
    confirmPassword: NEW_PW,
  });
  check(
    'password changed and session ended',
    redirectTarget(pwRes).includes('msg=password_changed'),
    redirectTarget(pwRes),
  );
  check('old password no longer works', !(await loginAs('owner@demo.gymflow.local')));
  check('new password works', await loginAs('owner@demo.gymflow.local', NEW_PW));

  // Rotate back, so this suite leaves the seed exactly as it found it — the
  // acceptance suite signs in as this same owner and must not depend on
  // whether e2e-admin.mjs ran first.
  const restoreForm = extractForm(
    await (await getFollow('/account/password')).text(),
    'currentPassword',
  );
  const restoreRes = await postAction('/account/password', restoreForm, {
    currentPassword: NEW_PW,
    newPassword: PASSWORD,
    confirmPassword: PASSWORD,
  });
  check(
    'password restored to the seed value',
    redirectTarget(restoreRes).includes('msg=password_changed'),
    redirectTarget(restoreRes),
  );
  check('seed password works again', await loginAs('owner@demo.gymflow.local'));

  // ---- member session security ------------------------------------------
  // Three findings from the pre-release security review, each verified here
  // over real HTTP rather than by reading the code.
  console.log('\n[member session security]');
  const memberMobile = memberRowDb.mobile.replace('+91', '');
  const memberLogin = async () => {
    const r = await fetch(`${BASE}/api/member/v1/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gymCode: 'apfitness', mobile: memberMobile, password: appPw }),
    });
    return r.ok ? await r.json() : null;
  };

  // 1. Sign-out must actually revoke the refresh token, not just forget it.
  const outTokens = await memberLogin();
  check('member signs in for the sign-out test', Boolean(outTokens?.refreshToken));
  const logoutRes = await fetch(`${BASE}/api/member/v1/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: outTokens.refreshToken }),
  });
  check('logout accepted', logoutRes.status === 204, String(logoutRes.status));
  const afterLogout = await fetch(`${BASE}/api/member/v1/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: outTokens.refreshToken }),
  });
  check(
    'refresh token is dead after sign-out',
    afterLogout.status === 401,
    String(afterLogout.status),
  );

  // 2. Suspending the gym must stop refresh rotation, not just fresh logins.
  const susTokens = await memberLogin();
  check('member signs in before suspension', Boolean(susTokens?.refreshToken));
  await db.query(`UPDATE tenants SET status = 'suspended' WHERE slug = 'apfitness'`);
  try {
    const susRefresh = await fetch(`${BASE}/api/member/v1/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: susTokens.refreshToken }),
    });
    check(
      'suspended gym cannot rotate a refresh token',
      susRefresh.status === 401,
      String(susRefresh.status),
    );
  } finally {
    await db.query(`UPDATE tenants SET status = 'active' WHERE slug = 'apfitness'`);
  }

  // 3. Login must not answer "does this account exist?" through its timing.
  const timeLogin = async (mobile) => {
    const t0 = performance.now();
    await fetch(`${BASE}/api/member/v1/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gymCode: 'apfitness', mobile, password: 'definitely-wrong-pw' }),
    });
    return performance.now() - t0;
  };
  const med = async (mobile) => {
    const runs = [];
    for (let i = 0; i < 5; i += 1) runs.push(await timeLogin(mobile));
    return runs.sort((a, b) => a - b)[2];
  };
  const known = await med(memberMobile);
  const unknown = await med('9000000099');
  // Before the fix the unknown branch skipped scrypt entirely and answered
  // ~16x faster. Anything under 3x is noise on a shared box.
  check(
    'login timing does not reveal whether an account exists',
    Math.max(known, unknown) / Math.max(1, Math.min(known, unknown)) < 3,
    `known=${known.toFixed(0)}ms unknown=${unknown.toFixed(0)}ms`,
  );

  // 4. Cross-site posts to the credential handler are refused outright.
  const csrf = await fetch(`${BASE}/credentials`, {
    method: 'POST',
    headers: { cookie, 'Sec-Fetch-Site': 'cross-site' },
    body: new URLSearchParams({ kind: 'staff_reset', userId: memberId }),
    redirect: 'manual',
  });
  check('cross-site post to /credentials refused', csrf.status === 403, String(csrf.status));

  // ---- member-initiated account deletion (Apple 5.1.1(v) / Play) ----------
  // Store-blocking feature: it must actually delete the login, and it must
  // NOT delete the gym's financial records.
  console.log('\n[member account deletion]');
  const delLogin = await fetch(`${BASE}/api/member/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      gymCode: 'apfitness',
      mobile: memberRowDb.mobile.replace('+91', ''),
      password: appPw,
    }),
  });
  check('member signs in before deleting', delLogin.status === 200, String(delLogin.status));
  const delTokens = delLogin.status === 200 ? await delLogin.json() : null;
  const [paymentsBefore] = await q(`SELECT count(*)::int AS n FROM payments WHERE member_id = $1`, [
    memberId,
  ]);
  if (delTokens) {
    const unauth = await fetch(`${BASE}/api/member/v1/account`, { method: 'DELETE' });
    check('deletion requires authentication', unauth.status === 401, String(unauth.status));

    const delRes = await fetch(`${BASE}/api/member/v1/account`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${delTokens.accessToken}` },
    });
    check('account deletion accepted', delRes.status === 200, String(delRes.status));

    const [afterDel] = await q(`SELECT user_id FROM members WHERE id = $1`, [memberId]);
    check('login unlinked from the member', afterDel.user_id === null, JSON.stringify(afterDel));
    const [reqRow] = await q(
      `SELECT count(*)::int AS n FROM member_deletion_requests
       WHERE member_id = $1 AND handled_at IS NULL`,
      [memberId],
    );
    check('deletion request recorded for the gym', reqRow.n === 1, String(reqRow.n));
    const [paymentsAfter] = await q(
      `SELECT count(*)::int AS n FROM payments WHERE member_id = $1`,
      [memberId],
    );
    check(
      'financial records survive deletion',
      paymentsAfter.n === paymentsBefore.n && paymentsAfter.n > 0,
      `${paymentsBefore.n} → ${paymentsAfter.n}`,
    );
    const relogin = await fetch(`${BASE}/api/member/v1/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gymCode: 'apfitness',
        mobile: memberRowDb.mobile.replace('+91', ''),
        password: appPw,
      }),
    });
    check('deleted member can no longer sign in', relogin.status !== 200, String(relogin.status));
  }

  // ---- public account-deletion page (Play requires a reachable URL) -------
  const delPage = await fetch(`${BASE}/account-deletion`);
  const delPageBody = delPage.ok ? await delPage.text() : '';
  check(
    'public account-deletion page is reachable without login',
    delPage.status === 200 && delPageBody.includes('Delete your'),
    String(delPage.status),
  );

  // ---- health endpoint ----------------------------------------------------
  const health = await fetch(`${BASE}/api/health`);
  const healthBody = health.ok ? await health.json() : null;
  check('health endpoint reports ok', health.status === 200 && healthBody?.status === 'ok');

  // ---- cleanup test member -------------------------------------------------
  await db.query(`DELETE FROM attendance WHERE member_id = $1`, [memberId]);

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
