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
/**
 * The seed owner's stored password hash, held while the suite has rotated it.
 *
 * The suite rotates owner@demo.gymflow.local to test the change-password
 * flow and rotates it back. A crash in between used to leave the seed
 * poisoned: every later run of this suite, and of e2e-acceptance.mjs, then
 * failed to sign that owner in — surfacing as four unrelated-looking tenant
 * isolation failures and sending the reader hunting for an RLS bug that was
 * never there. The outer finally puts it back whatever happens.
 */
let ownerPasswordHash = null;
let passed = 0;
const failures = [];

async function restoreOwnerPassword() {
  if (!ownerPasswordHash) return;
  console.error('\nRestoring the seed owner password after an interrupted run.');
  await db.query(
    `UPDATE user_credentials SET password_hash = $1
      WHERE user_id = (SELECT id FROM users WHERE email = 'owner@demo.gymflow.local')`,
    [ownerPasswordHash],
  );
  ownerPasswordHash = null;
}

// A signal does not run .finally(): Node exits straight away. A run stopped
// by Ctrl-C, or by the `timeout` that wraps this suite, therefore used to
// leave the rotated password in place and break every later run of this
// suite and of e2e-acceptance.mjs — as an owner login failure a long way
// from its cause. Restore on the way out too.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, () => {
    restoreOwnerPassword()
      .catch((err) => console.error('Could not restore the seed owner password:', err))
      .finally(() => process.exit(sig === 'SIGINT' ? 130 : 143));
  });
}

function check(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ✗ ${name} ${detail}`);
  }
}

/**
 * Absorb any cookies a response sets, the way a browser would.
 *
 * The harness used to keep only the session cookie captured at login, so any
 * flow that relies on a second cookie could not be tested at all — including
 * the onboarding step now that the member's phone number is carried in a
 * short-lived cookie instead of the query string.
 */
function absorbCookies(res) {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const [name] = pair.split('=');
    const others = cookie
      .split('; ')
      .filter((c) => c && !c.startsWith(`${name}=`))
      .join('; ');
    // A deletion sets an empty value; drop it rather than sending an empty one.
    cookie = pair.endsWith('=') ? others : [others, pair].filter(Boolean).join('; ');
  }
}

async function get(path) {
  const res = await fetch(BASE + path, { headers: { cookie }, redirect: 'manual' });
  absorbCookies(res);
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
  absorbCookies(res);
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
  // postAction absorbs Set-Cookie, so the session lands in `cookie` already.
  await postAction('/login', loginForm, { email, password });
  return cookie.includes('gymflow_session=');
}

async function main() {
  await db.connect();
  console.log(`E2E against ${BASE}`);

  // This suite deliberately fails logins — a wrong current password, a
  // rotated-away password, a timing probe against an unknown mobile — and the
  // product locks an identifier out after 8 failures in 15 minutes. That is
  // correct behaviour, and it is also why two runs inside the same quarter of
  // an hour used to break the second one: the owner login stopped working
  // several blocks before the test that cared, and read as an unrelated
  // failure. Clear the counters this suite itself put there before starting.
  await db.query(
    `DELETE FROM login_attempts
      WHERE succeeded = false
        AND (identifier LIKE '%@demo.gymflow.local' OR identifier LIKE 'apfitness:%')`,
  );

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
  let appPw = enableHtml.match(/<code>([^<]+)<\/code>/)?.[1] ?? '';
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
  // Find the row by its receipt number, not by its amount: the export orders
  // by payment_date, which is a date, so every payment taken today ties and
  // an amount match picks whichever equal-valued payment an earlier run of
  // this suite happened to leave first.
  const [refundedReceipt] = await q(`SELECT receipt_number FROM receipts WHERE payment_id = $1`, [
    payRow.id,
  ]);
  const csvRow = payCsv.split('\n').find((l) => l.startsWith(`${refundedReceipt.receipt_number},`));
  check(
    'payments export shows the refund and the net',
    Boolean(csvRow) &&
      csvRow.split(',').includes('50000') &&
      csvRow.split(',').includes(String(Number(payRow.amount) - 50000)),
    csvRow ?? `no export row for receipt ${refundedReceipt?.receipt_number}`,
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
  // Snapshot the stored hash before rotating, so the outer finally can put
  // it back byte for byte no matter where the suite stops.
  ownerPasswordHash = (
    await db.query(
      `SELECT password_hash FROM user_credentials
        WHERE user_id = (SELECT id FROM users WHERE email = 'owner@demo.gymflow.local')`,
    )
  ).rows[0].password_hash;
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

  ownerPasswordHash = null;

  // ---- money guards at the desk ------------------------------------------
  // Two ways a slipped keystroke used to become permanent.
  console.log('\n[payment guards]');
  const payPath = `/members/${memberId}/payment`;
  const payHtml = await (await getFollow(payPath)).text();
  // Match the whole <input> tag rather than assuming attribute order.
  const dateTag = (payHtml.match(/<input[^>]*>/g) ?? []).find((tag) =>
    tag.includes('name="paymentDate"'),
  );
  check(
    'the payment date input is bounded in the browser',
    Boolean(dateTag && /\bmin="/.test(dateTag) && /\bmax="/.test(dateTag)),
    dateTag ?? 'no paymentDate input in the page',
  );

  const [openMs] = await q(
    `SELECT id FROM memberships WHERE member_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [memberId],
  );
  const backdated = await postAction(payPath, extractForm(payHtml, 'paymentDate'), {
    membershipId: openMs.id,
    amount: '100',
    method: 'cash',
    paymentDate: '2019-06-01',
  });
  check(
    'a payment dated in a closed financial year is refused',
    decodeURIComponent(redirectTarget(backdated)).includes('more than 30 days ago'),
    decodeURIComponent(redirectTarget(backdated)).slice(-120),
  );

  const future = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
  const futureRes = await postAction(
    payPath,
    extractForm(await (await getFollow(payPath)).text(), 'paymentDate'),
    { membershipId: openMs.id, amount: '100', method: 'cash', paymentDate: future },
  );
  check(
    'a payment dated in the future is refused',
    decodeURIComponent(redirectTarget(futureRes)).includes('future'),
    decodeURIComponent(redirectTarget(futureRes)).slice(-120),
  );

  const overRes = await postAction(
    payPath,
    extractForm(await (await getFollow(payPath)).text(), 'paymentDate'),
    { membershipId: openMs.id, amount: '999999', method: 'cash' },
  );
  check(
    'a payment larger than the outstanding balance is refused',
    /more than the amount due|already paid in full/.test(
      decodeURIComponent(redirectTarget(overRes)),
    ),
    decodeURIComponent(redirectTarget(overRes)).slice(-140),
  );
  const [negCheck] = await q(
    `SELECT count(*)::int AS n FROM payments p
      JOIN payment_allocations pa ON pa.payment_id = p.id
      WHERE pa.membership_id = $1 AND p.amount > 900000`,
    [openMs.id],
  );
  check('and no over-payment reached the ledger', negCheck.n === 0, String(negCheck.n));

  // ---- member forgot their app password ----------------------------------
  // The member detail page used to replace the activation button with the
  // text "Member app: enabled" once a login existed, so a member who forgot
  // their password could not be given a new one by anyone, at any desk.
  console.log('\n[member app password reset]');
  const memberPage = await (await getFollow(`/members/${memberId}`)).text();
  check(
    'the member page offers a password reset once access exists',
    /Reset app password/.test(memberPage),
  );
  const resetFd = new URLSearchParams();
  resetFd.set('kind', 'member_app');
  resetFd.set('memberId', memberId);
  const memberResetRes = await fetch(`${BASE}/credentials`, {
    method: 'POST',
    headers: { cookie },
    body: resetFd,
  });
  const newAppPw = (await memberResetRes.text()).match(/<code>([^<]+)<\/code>/)?.[1] ?? '';
  check('a new one-time password is issued', memberResetRes.status === 200 && newAppPw.length >= 8);
  check('the reissued password differs from the first', newAppPw !== appPw);
  const memberMobileDigits = memberRowDb.mobile.replace('+91', '');
  const tryMemberPw = async (pw) =>
    (
      await fetch(`${BASE}/api/member/v1/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gymCode: 'apfitness', mobile: memberMobileDigits, password: pw }),
      })
    ).status;
  check('the old app password stops working', (await tryMemberPw(appPw)) === 401);
  check('the member can sign in with the new one', (await tryMemberPw(newAppPw)) === 200);
  appPw = newAppPw;

  // ---- every member endpoint the app calls -------------------------------
  // Four of the nine were exercised by no test at all, including the two the
  // member reads most (payments, attendance) and the one reception depends on
  // at the door (pass).
  console.log('\n[member API surface]');
  const apiTokens = await (async () => {
    const r = await fetch(`${BASE}/api/member/v1/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gymCode: 'apfitness',
        mobile: memberRowDb.mobile.replace('+91', ''),
        password: appPw,
      }),
    });
    return r.ok ? await r.json() : null;
  })();
  check('member signs in for the API sweep', Boolean(apiTokens?.accessToken));
  const asMember = (path) =>
    fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${apiTokens.accessToken}` } });

  for (const path of [
    '/api/member/v1/me',
    '/api/member/v1/payments',
    '/api/member/v1/attendance',
    '/api/member/v1/pt',
    '/api/member/v1/offers',
    '/api/member/v1/pass',
    '/api/member/v1/notifications',
  ]) {
    const res = await asMember(path);
    const body = res.ok ? await res.json() : null;
    check(
      `GET ${path} answers 200 with JSON`,
      res.status === 200 && body !== null,
      String(res.status),
    );
    // Every one of these must refuse an unauthenticated caller: they all
    // return one member's personal data.
    const anon = await fetch(`${BASE}${path}`);
    check(`GET ${path} refuses an anonymous caller`, anon.status === 401, String(anon.status));
  }

  // Attendance timestamps cross the API in the gym's calendar day, like every
  // other date in the product — not the database's UTC day.
  const attRes = await asMember('/api/member/v1/attendance');
  const attBody = await attRes.json();
  if (attBody.attendance?.length) {
    const stamp = String(attBody.attendance[0].checked_in_at);
    check(
      'check-in timestamps are in the gym timezone, not UTC',
      !/Z$|\+00$|\+00:00$/.test(stamp),
      stamp,
    );
    const [dbRow] = await q(
      `SELECT (a.checked_in_at AT TIME ZONE t.default_timezone)::text AS local
         FROM attendance a JOIN tenants t ON t.id = a.tenant_id
        WHERE a.member_id = $1 ORDER BY a.checked_in_at DESC LIMIT 1`,
      [memberId],
    );
    check(
      'and match the tenant-local value in the database',
      Boolean(dbRow) && stamp.slice(0, 16) === dbRow.local.slice(0, 16),
      `${stamp} vs ${dbRow?.local}`,
    );
  }

  // ---- what the member app is actually told -------------------------------
  // The app can only say what the API tells it. These are the facts the
  // member screens were rewritten around.
  console.log('\n[what the member app is told]');
  const memberMobileForApp = memberRowDb.mobile.replace('+91', '');
  const loginAs2 = (gymCode, mobile, password) =>
    fetch(`${BASE}/api/member/v1/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gymCode, mobile, password }),
    });

  // A wrong gym code is the field members get wrong most often, and it is
  // not their password. The gym directory is already public (the
  // account-deletion page looks gyms up by code), so saying so gives
  // nothing away.
  const badGym = await loginAs2('nosuchgym', memberMobileForApp, appPw);
  check(
    'a gym code that does not exist says so',
    badGym.status === 404 && (await badGym.json()).error === 'gym_not_found',
    String(badGym.status),
  );
  // But who is a member of a gym stays private.
  const badPw = await loginAs2('apfitness', memberMobileForApp, 'definitely-not-it');
  const badPwBody = await badPw.json();
  const noSuchMember = await loginAs2('apfitness', '9000000123', 'definitely-not-it');
  check(
    'a wrong password and an unregistered number are still indistinguishable',
    badPw.status === 401 &&
      noSuchMember.status === 401 &&
      badPwBody.error === (await noSuchMember.json()).error,
    `${badPw.status}/${noSuchMember.status}`,
  );

  const appTokens = await (await loginAs2('apfitness', memberMobileForApp, appPw)).json();
  const meForApp = await (
    await fetch(`${BASE}/api/member/v1/me`, {
      headers: { Authorization: `Bearer ${appTokens.accessToken}` },
    })
  ).json();
  check(
    'the app is told which features this gym runs',
    typeof meForApp.features?.pt === 'boolean' &&
      typeof meForApp.features?.attendance === 'boolean',
    JSON.stringify(meForApp.features),
  );
  check(
    'and when the grace period actually ends, so it need not guess',
    typeof meForApp.membership?.graceEndDate === 'string' &&
      meForApp.membership.graceEndDate >= meForApp.membership.endDate,
    JSON.stringify(meForApp.membership?.graceEndDate),
  );

  // A gym with personal training switched off should not have a PT endpoint
  // answering for its members. Hiding the tab alone is a UI-only fix.
  await db.query(
    `INSERT INTO feature_flags (tenant_id, key, enabled)
     SELECT id, 'pt', false FROM tenants WHERE slug = 'apfitness'
     ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = false`,
  );
  try {
    const ptOff = await fetch(`${BASE}/api/member/v1/pt`, {
      headers: { Authorization: `Bearer ${appTokens.accessToken}` },
    });
    check(
      'with PT switched off the endpoint stops answering, not just the tab',
      ptOff.status === 404,
      String(ptOff.status),
    );
    const meOff = await (
      await fetch(`${BASE}/api/member/v1/me`, {
        headers: { Authorization: `Bearer ${appTokens.accessToken}` },
      })
    ).json();
    check('and /me reports it so the app can drop the tab', meOff.features?.pt === false);
  } finally {
    await db.query(
      `UPDATE feature_flags SET enabled = true
        WHERE key = 'pt' AND tenant_id = (SELECT id FROM tenants WHERE slug = 'apfitness')`,
    );
  }

  // ---- the gym writes to a member in the member's language ---------------
  // The app kept the language choice in AsyncStorage and never told the
  // server, so users.language stayed 'en' for every member ever created and
  // the notifications rendered at payment and renewal time — which read that
  // column — were English for a Telugu speaker whatever they had picked. The
  // screens were translated; the messages the gym sends were not.
  console.log('\n[notifications follow the member, not the desk]');
  const langTokens = await (await loginAs2('apfitness', memberMobileForApp, appPw)).json();
  const setTe = await fetch(`${BASE}/api/member/v1/me`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${langTokens.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ language: 'te' }),
  });
  check('a member can set their language', setTe.status === 204, String(setTe.status));
  const badLang = await fetch(`${BASE}/api/member/v1/me`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${langTokens.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ language: 'klingon' }),
  });
  check('and only to one we actually ship', badLang.status === 400, String(badLang.status));
  const anonLang = await fetch(`${BASE}/api/member/v1/me`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language: 'te' }),
  });
  check('not without signing in', anonLang.status === 401, String(anonLang.status));

  // Now take a payment at the desk and read what the member was sent.
  check('reception relogin for the notification check', await loginAs(EMAIL));
  const notifyPath = `/members/${memberId}/payment`;
  const notifyForm = extractForm(await (await getFollow(notifyPath)).text(), 'amount');
  // Deliberately unattached to a membership: by this point in the suite this
  // member's membership is paid in full and the product rightly refuses an
  // overpayment against it. A standalone counter payment takes the same code
  // path to the same notification and does not depend on what the blocks
  // above left the balance at.
  const notifyRes = await postAction(notifyPath, notifyForm, {
    memberId,
    membershipId: '',
    amount: '100',
    method: 'cash',
  });
  absorbCookies(notifyRes);
  check(
    'the desk payment went through',
    redirectTarget(notifyRes).includes('/receipts/'),
    decodeURIComponent(redirectTarget(notifyRes)),
  );
  const [note] = (
    await db.query(
      `SELECT rendered_body FROM notification_deliveries
        WHERE member_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [memberId],
    )
  ).rows;
  check(
    'the payment notification is written in Telugu, not English',
    /[ఀ-౿]/.test(note?.rendered_body ?? ''),
    note?.rendered_body ?? 'no notification',
  );
  check(
    'and it carries the receipt number, not a bare placeholder',
    !(note?.rendered_body ?? '').includes('{{receipt}}'),
    note?.rendered_body ?? '',
  );
  // Put the seed back the way it was.
  await db.query(
    `UPDATE users SET language = 'en' WHERE id = (SELECT user_id FROM members WHERE id = $1)`,
    [memberId],
  );
  // This block signs in at the desk; everything after it reads reports and
  // exports, which a receptionist rightly cannot. Hand the session back.
  check('owner relogin after the notification check', await loginAs('owner@demo.gymflow.local'));

  // ---- a hidden field is not a promise -----------------------------------
  // Actions took the member id from a hidden input and concatenated it into
  // two places: the URL they redirect back to, and the Path of the cookie
  // holding what was typed. A hand-rolled POST controls that field, and a
  // single semicolon in it appended an attribute to the Set-Cookie header —
  // Domain= on a cookie carrying the member details just entered. A CR/LF
  // answered 500 and `../..` moved the redirect elsewhere on the site.
  console.log('\n[a forged hidden id cannot shape a header]');
  const forgeBase = `/members/${memberId}/payment`;
  const forgeForm = extractForm(await (await getFollow(forgeBase)).text(), 'amount');
  const FORGERIES = [
    ['a semicolon cannot add a cookie attribute', `${memberId}; Domain=example.test`],
    ['a CR/LF cannot split the header', `${memberId}\r\nSet-Cookie: injected=1`],
    ['dot-dot cannot move the redirect', '../..'],
    ['and a non-uuid is simply not a member', 'x'.repeat(64)],
  ];
  for (const [name, forged] of FORGERIES) {
    const res = await fetch(BASE + forgeBase, {
      method: 'POST',
      headers: { cookie },
      body: (() => {
        const fd = new FormData();
        fd.set(`$ACTION_ID_${forgeForm.actionId}`, '');
        for (const [k, v] of Object.entries(forgeForm.hidden)) fd.set(k, v);
        fd.set('memberId', forged);
        fd.set('amount', 'not-a-number'); // the branch that writes the draft cookie
        fd.set('method', 'cash');
        return fd;
      })(),
      redirect: 'manual',
    });
    const setCookies = res.headers.getSetCookie?.() ?? [];
    const draftCookies = setCookies.filter((c) => c.includes('gymflow_draft'));
    check(
      name,
      res.status === 404 && draftCookies.length === 0,
      `${res.status} ${JSON.stringify(draftCookies)}`,
    );
  }
  // The refund action lives outside the members route group and was the one
  // action the UUID guard was not applied to, with the same shape: a hidden
  // paymentId concatenated straight into both of its redirects.
  const refundBase = `/receipts/${payRow.id}`;
  const refundGuardForm = extractForm(await (await getFollow(refundBase)).text(), 'paymentId');
  for (const [name, forged] of [
    ['the refund action refuses a CR/LF payment id', `${payRow.id}\r\nSet-Cookie: injected=1`],
    ['and a payment id that is not an id at all', 'not-a-uuid'],
  ]) {
    const fd = new FormData();
    fd.set(`$ACTION_ID_${refundGuardForm.actionId}`, '');
    for (const [k, v] of Object.entries(refundGuardForm.hidden)) fd.set(k, v);
    fd.set('paymentId', forged);
    fd.set('amount', 'abc'); // force the catch branch that builds the redirect
    fd.set('reason', 'guard check');
    const res = await fetch(BASE + refundBase, {
      method: 'POST',
      headers: { cookie },
      body: fd,
      redirect: 'manual',
    });
    check(name, res.status === 404, `${res.status} ${redirectTarget(res).slice(0, 80)}`);
  }

  // The same form still works when the id is the real one.
  const honestForm = extractForm(await (await getFollow(forgeBase)).text(), 'amount');
  const honestRes = await postAction(forgeBase, honestForm, {
    memberId,
    membershipId: '',
    amount: 'not-a-number',
    method: 'cash',
  });
  check(
    'a real id still gets its draft kept',
    (honestRes.headers.getSetCookie?.() ?? []).some((c) => c.includes('gymflow_draft_payment')),
    String(honestRes.status),
  );
  absorbCookies(honestRes);

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
  // Both mobiles must be fresh every run. A fixed "unknown" number
  // accumulated failed attempts across runs, and once it crossed the
  // per-identifier lockout the route answered 429 in 6ms without ever
  // reaching scrypt — which looks exactly like the timing leak this check
  // exists to catch. Two consecutive runs of the suite inside the 15-minute
  // throttle window were enough to fake a security regression.
  const unknownMobile = `9${String(Math.floor(100000000 + Math.random() * 899999999))}`;
  const known = await med(memberMobile);
  const unknown = await med(unknownMobile);
  const [attempts] = (
    await db.query(
      `SELECT count(*) FILTER (WHERE NOT succeeded)::int AS n FROM login_attempts
        WHERE identifier = $1 AND attempted_at > now() - interval '15 minutes'`,
      [`apfitness:+91${unknownMobile}`],
    )
  ).rows;
  check(
    'the timing probe stayed under the lockout threshold',
    attempts.n <= 8,
    `${attempts.n} failed attempts recorded — the probe itself tripped the throttle`,
  );
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

  // ---- member data must not travel in URLs -------------------------------
  console.log('\n[no member data in URLs]');
  const newMobile = `9${String(Math.floor(100000000 + Math.random() * 899999999))}`;
  const urlStep1Form = extractForm(await (await getFollow('/members/new')).text(), 'mobile');
  const step1Res = await postAction('/members/new', urlStep1Form, { mobile: newMobile });
  const step1Target = redirectTarget(step1Res);
  check(
    'step 1 does not put the phone number in the redirect URL',
    !step1Target.includes(newMobile) && !decodeURIComponent(step1Target).includes(newMobile),
    step1Target,
  );
  // …and it still reaches step 2 with the right number pre-filled.
  const urlStep2Html = await (await getFollow(step1Target.replace(/^https?:\/\/[^/]+/, ''))).text();
  check(
    'and step 2 still knows which number it is',
    urlStep2Html.includes(newMobile) || urlStep2Html.includes(`+91${newMobile}`),
  );

  // Exports must not mangle the column the gym cares about most.
  const membersCsvRes = await getFollow('/api/export/members');
  const membersCsv = await membersCsvRes.text();
  check(
    'exported phone numbers are not prefixed with an apostrophe',
    !/,'\+91/.test(membersCsv),
    membersCsv.split('\n')[1]?.slice(0, 90) ?? '',
  );
  check('and are still present', /\+91\d{10}/.test(membersCsv));

  // ---- public store-required pages ---------------------------------------
  // Both stores need these reachable with no login and actually useful — a
  // page that says "ask reception" and gives no contact is a rejection, and
  // so is a policy URL full of placeholders.
  console.log('\n[public store pages]');
  const noCookie = (path) => fetch(`${BASE}${path}`, { redirect: 'manual' });
  const deletionNoGym = await noCookie('/account-deletion');
  const deletionNoGymHtml = await deletionNoGym.text();
  check(
    'the deletion page offers a gym-code lookup when no gym is known',
    deletionNoGym.status === 200 && deletionNoGymHtml.includes('name="gym"'),
  );
  const deletionWithGym = await (await noCookie('/account-deletion?gym=apfitness')).text();
  check(
    'and resolves that gym to a real phone number',
    /href="tel:\+?\d{6,}"/.test(deletionWithGym),
  );
  check('and to a WhatsApp link', /wa\.me\/\d{6,}/.test(deletionWithGym));
  const deletionBadGym = await (await noCookie('/account-deletion?gym=nosuchgym')).text();
  check(
    'an unknown gym code is explained, not silently blank',
    /could not find a gym/i.test(deletionBadGym),
  );
  const privacy = await noCookie('/privacy');
  const privacyHtml = await privacy.text();
  check('the app privacy policy is public', privacy.status === 200, String(privacy.status));
  check(
    'the privacy policy has no unfilled placeholders',
    !/\[Gym name\]|\[phone|\[email/i.test(privacyHtml),
  );
  check(
    'it declares the check-in and PT data the app actually fetches',
    /check-?in/i.test(privacyHtml) && /personal.training/i.test(privacyHtml),
  );

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

  // ---- the renewal queue does not quietly end at 30 -----------------------
  // The dashboard card listed the first 30 memberships expiring in its
  // window with no way to reach the rest, and no total — so a gym with 200
  // renewals due could work 30 of them and never learn the other 170
  // existed.
  console.log('\n[the whole renewal queue]');
  const renewalsRes = await getFollow('/renewals?window=7');
  check('there is a renewals page at all', renewalsRes.status === 200, String(renewalsRes.status));
  const renewalsHtml = await renewalsRes.text();
  const [dueSoon] = (
    await db.query(
      `SELECT count(*)::int AS n FROM memberships ms JOIN tenants t ON t.id = ms.tenant_id
        WHERE t.slug = 'apfitness' AND ms.state = 'active'
          AND ms.end_date BETWEEN $1::date AND $1::date + 7`,
      [istToday],
    )
  ).rows;
  check(
    'it states the true total, not the length of a capped list',
    renewalsHtml.includes(`${dueSoon.n} memberships in this window`),
    `expected ${dueSoon.n}`,
  );
  check(
    'every row can be acted on, not just read',
    !dueSoon.n || (renewalsHtml.includes('/renew') && renewalsHtml.includes('wa.me')),
    'no renew or WhatsApp action on the queue',
  );
  for (const w of ['overdue', 'today', '15', '30']) {
    const res = await getFollow(`/renewals?window=${w}`);
    if (res.status !== 200) {
      check(`the ${w} window opens`, false, String(res.status));
      break;
    }
  }
  check('and every window opens', true);
  // `in` walks the prototype chain, so the first version of the window guard
  // accepted ?window=constructor and ?window=toString and then read a
  // function off Object.prototype where it expected a date range.
  for (const w of ['../../etc/passwd', 'constructor', 'toString', '__proto__', 'valueOf', '']) {
    const res = await getFollow(`/renewals?window=${encodeURIComponent(w)}`);
    check(
      `an unusable window (${w || 'empty'}) falls back rather than erroring`,
      res.status === 200,
      String(res.status),
    );
  }

  // The dashboard promises a number and links somewhere; the two must be the
  // same set. The card counts [today-7, today+7] and used to link to
  // window=7, which is [today, today+7] — a smaller list than the number
  // offered, which is the very mismatch this finding is about.
  const queueRes = await getFollow('/renewals?window=queue');
  const queueHtml = await queueRes.text();
  const [cardTotal] = (
    await db.query(
      `SELECT count(*)::int AS n FROM memberships ms JOIN tenants t ON t.id = ms.tenant_id
        WHERE t.slug = 'apfitness' AND ms.state = 'active'
          AND ms.end_date BETWEEN $1::date - 7 AND $1::date + 7`,
      [istToday],
    )
  ).rows;
  check(
    'the dashboard link lands on exactly the set it counted',
    queueHtml.includes(`${cardTotal.n} memberships in this window`),
    `expected ${cardTotal.n}`,
  );
  // Two links, two counts, and each must go to the range it counted.
  // The "See all N" link only appears when the preview is truncated, so this
  // asserts the pairing rather than the presence.
  const dashForLink = await (await getFollow('/')).text();
  const seeAll = dashForLink.match(/href="\/renewals\?window=([a-z0-9]+)"[^>]*>\s*See all/);
  check(
    'if the queue is truncated, "See all" goes to the range the heading counted',
    seeAll === null || seeAll[1] === 'queue',
    `See all -> window=${seeAll?.[1]}`,
  );
  // The "Expiring in 7 days" stat counts [today, today+7], so it links to
  // window=7 — the one that is exactly that range.
  check(
    'the expiring-in-7-days card links to the 7-day window',
    dashForLink.includes('/renewals?window=7'),
    'the stat card links somewhere other than its own range',
  );
  const [stat7] = (
    await db.query(
      `SELECT count(*)::int AS n FROM memberships ms JOIN tenants t ON t.id = ms.tenant_id
        WHERE t.slug = 'apfitness' AND ms.state = 'active'
          AND ms.end_date BETWEEN $1::date AND $1::date + 7`,
      [istToday],
    )
  ).rows;
  const sevenHtml = await (await getFollow('/renewals?window=7')).text();
  check(
    'and that window holds exactly the number the card showed',
    sevenHtml.includes(`${stat7.n} memberships in this window`),
    `expected ${stat7.n}`,
  );

  // "Overdue" must mean everyone past their expiry date. The nightly sweep
  // leaves a membership 'active' through its grace period and flips it to
  // 'expired' afterwards, so an overdue list restricted to 'active' showed
  // only the grace cohort and hid everyone who had actually lapsed.
  const overdueHtml = await (await getFollow('/renewals?window=overdue')).text();
  const [lapsed] = (
    await db.query(
      `SELECT count(*)::int AS n FROM memberships ms JOIN tenants t ON t.id = ms.tenant_id
        WHERE t.slug = 'apfitness' AND ms.state IN ('active','expired')
          AND ms.end_date < $1::date`,
      [istToday],
    )
  ).rows;
  check(
    'overdue counts everyone past their expiry date, grace or lapsed',
    overdueHtml.includes(`${lapsed.n} memberships in this window`),
    `expected ${lapsed.n}`,
  );
  check('and there really are some to find', lapsed.n > 0, String(lapsed.n));
  const dashHtml = await (await getFollow('/')).text();
  check(
    'the dashboard card links to the full queue',
    dashHtml.includes('/renewals'),
    'no drill-down from the dashboard',
  );

  // ---- who took the cash ---------------------------------------------------
  // payments.received_by has been recorded since the first migration and was
  // only ever visible on one receipt at a time, so closing the till meant
  // opening receipts one by one.
  console.log('\n[cash up]');
  const cashUpHtml = await (await getFollow(`/reports?from=${istToday}&to=${istToday}`)).text();
  check(
    'the reports page has a cash-up table',
    cashUpHtml.includes('Cash up') || cashUpHtml.includes('క్యాష్ అప్'),
    'no cash-up section',
  );
  check('it names who collected', cashUpHtml.includes('Collected by'), 'no collector column');
  check(
    'and separates cash from the methods that reconcile against a statement',
    cashUpHtml.includes('Card / UPI / bank'),
    'cash not separated',
  );

  // ---- a rejected form keeps what was typed -------------------------------
  // Every form except New member threw the entry away on a validation error.
  // Selling a membership is seven fields filled in with a member waiting at
  // the counter; getting the amount wrong meant choosing the plan, the date,
  // the promo code and the payment method all over again.
  console.log('\n[a rejected form keeps what was typed]');
  const draftMobile = `9${String(Math.floor(100000000 + Math.random() * 899999999))}`;
  const dStep1 = extractForm(await (await get('/members/new')).text(), 'mobile');
  const dDup = await postAction('/members/new', dStep1, { mobile: draftMobile });
  const dStep2Path = redirectTarget(dDup).replace(/^https?:\/\/[^/]+/, '');
  const dStep2Html = await (await get(dStep2Path)).text();
  const dCreate = await postAction(dStep2Path, extractForm(dStep2Html, 'firstName'), {
    mobile: draftMobile,
    branchId: dStep2Html.match(/<option[^>]*value="([a-f0-9-]{36})"/)?.[1],
    firstName: 'Draft',
    lastName: 'Keeper',
    referralSource: 'walk_in',
  });
  const dSellPath = redirectTarget(dCreate).replace(/^https?:\/\/[^/]+/, '');
  const draftMemberId = dSellPath.match(/members\/([a-f0-9-]+)\/sell/)?.[1];
  check('a member to sell to', Boolean(draftMemberId), dSellPath);

  // Fill the form in properly, but with an amount the server will reject.
  const draftSellHtml = await (await get(dSellPath)).text();
  const rejected = await postAction(dSellPath, extractForm(draftSellHtml, 'planId'), {
    memberId: draftMemberId,
    startDate: istToday,
    promotionCode: 'TYPO-CODE-42',
    amount: 'not-a-number',
    method: 'upi',
    externalReference: 'UTR-REF-9911',
  });
  check(
    'the sale is refused',
    decodeURIComponent(redirectTarget(rejected)).includes('error='),
    redirectTarget(rejected),
  );
  // The draft cookie rides back on the redirect, so follow it the way a
  // browser would.
  absorbCookies(rejected);
  // Follow the redirect the action issued, exactly as a browser would. The
  // draft is restored only on the ?error= URL, so that a stale draft cannot
  // pre-fill the form on a later clean visit.
  const rejectedTarget = redirectTarget(rejected).replace(/^https?:\/\/[^/]+/, '');
  const afterReject = await (await getFollow(rejectedTarget)).text();
  check(
    'the promo code they typed is still there',
    afterReject.includes('TYPO-CODE-42'),
    'promo code lost',
  );
  check('so is the payment reference', afterReject.includes('UTR-REF-9911'), 'reference lost');
  check(
    'and the payment method they picked, not the default',
    /name="method"[\s\S]{0,400}?<option[^>]*value="upi"[^>]*selected/.test(afterReject) ||
      afterReject.includes('value="upi" selected'),
    'method reset to the default',
  );
  check(
    'the amount that was rejected comes back so it can be corrected',
    afterReject.includes('not-a-number'),
    'amount lost',
  );
  // And none of it is in the URL: these forms carry member data, and the
  // product's rule is that member data never reaches an access log.
  // And the draft must NOT come back on a later clean visit. Someone whose
  // sale is refused and who then walks away leaves the cookie behind for its
  // full ten minutes; pre-filling an amount and a promo code the next person
  // never typed is worse than losing them.
  const cleanVisit = await (await getFollow(dSellPath)).text();
  check(
    'but a later clean visit starts empty, not pre-filled with a stale draft',
    !cleanVisit.includes('TYPO-CODE-42') && !cleanVisit.includes('UTR-REF-9911'),
    'an abandoned draft pre-filled a clean open',
  );
  check(
    'none of it travelled in the URL',
    !decodeURIComponent(redirectTarget(rejected)).includes('UTR-REF-9911') &&
      !decodeURIComponent(redirectTarget(rejected)).includes('TYPO-CODE-42'),
    redirectTarget(rejected),
  );

  // A successful sale must not leave the draft behind for the next member.
  // planId is a radio, so it is not among the form's hidden fields — pick the
  // plan the restored form has selected, the way a submit would.
  const keptPlanId =
    afterReject.match(/name="planId"\s+value="([a-f0-9-]{36})"\s+required\s+checked/)?.[1] ??
    afterReject.match(/name="planId"\s+value="([a-f0-9-]{36})"/)?.[1];
  check('the restored form still has a plan selected', Boolean(keptPlanId), String(keptPlanId));
  // This gym does not allow part payments, so pay the plan price exactly.
  // The joining fee is off: the rejected submission did not tick it, and the
  // restored form reflects what was actually submitted rather than the
  // original default — which is the point of restoring it.
  const [planPrice] = (
    await db.query(
      `SELECT v.base_price::bigint::text AS price
         FROM membership_plan_versions v
        WHERE v.plan_id = $1 ORDER BY v.version DESC LIMIT 1`,
      [keptPlanId],
    )
  ).rows;
  const goodSale = await postAction(dSellPath, extractForm(afterReject, 'planId'), {
    memberId: draftMemberId,
    planId: keptPlanId,
    startDate: istToday,
    promotionCode: '',
    manualDiscount: '',
    amount: (Number(planPrice.price) / 100).toFixed(2),
    method: 'cash',
  });
  absorbCookies(goodSale);
  check(
    'the sale goes through once corrected',
    redirectTarget(goodSale).includes('msg=sold'),
    redirectTarget(goodSale),
  );
  // A field the receptionist deliberately CLEARED must stay cleared. The
  // draft records empty strings for exactly this reason: on the edit form a
  // blank field means "erase this", and restoring the stored value would
  // undo the erasure without saying so.
  const draftEditPath = `/members/${draftMemberId}/edit`;
  const draftEditHtml = await (await getFollow(draftEditPath)).text();
  const withEmail = await postAction(draftEditPath, extractForm(draftEditHtml, 'firstName'), {
    memberId: draftMemberId,
    firstName: 'Draft',
    lastName: 'Keeper',
    mobile: draftMobile,
    email: 'keeper@example.test',
  });
  absorbCookies(withEmail);
  check(
    'an email can be set',
    redirectTarget(withEmail).includes('msg=edited'),
    redirectTarget(withEmail),
  );
  // Now clear the email AND trip a validation error on another field.
  const draftClearedHtml = await (await getFollow(draftEditPath)).text();
  const cleared = await postAction(draftEditPath, extractForm(draftClearedHtml, 'firstName'), {
    memberId: draftMemberId,
    firstName: 'Draft',
    lastName: 'Keeper',
    mobile: '12345',
    email: '',
  });
  absorbCookies(cleared);
  check(
    'the bad mobile is refused',
    decodeURIComponent(redirectTarget(cleared)).includes('valid 10-digit'),
    redirectTarget(cleared),
  );
  const clearedTarget = redirectTarget(cleared).replace(/^https?:\/\/[^/]+/, '');
  const afterClearEdit = await (await getFollow(clearedTarget)).text();
  check(
    'and the email they cleared has not come back',
    !afterClearEdit.includes('keeper@example.test'),
    'a deliberately cleared field was restored from the stored value',
  );

  // The same protection on the settings form, which is sixteen fields
  // including both WhatsApp renewal templates. A mistyped GSTIN used to
  // discard the Telugu template someone had just written.
  check('owner relogin for settings', await loginAs('owner@demo.gymflow.local'));
  const settingsHtml = await (await getFollow('/settings')).text();
  const TE_TEMPLATE = 'నమస్తే {{member_first_name}} — డ్రాఫ్ట్ పరీక్ష';
  const badGstin = await postAction('/settings', extractForm(settingsHtml, 'receiptPrefix'), {
    gstin: 'NOT-A-GSTIN',
    waTemplateTe: TE_TEMPLATE,
    receiptPrefix: 'SVF',
  });
  absorbCookies(badGstin);
  check(
    'a malformed GSTIN is refused',
    decodeURIComponent(redirectTarget(badGstin)).includes('GSTIN must be'),
    redirectTarget(badGstin),
  );
  const gstinTarget = redirectTarget(badGstin).replace(/^https?:\/\/[^/]+/, '');
  const afterGstin = await (await getFollow(gstinTarget)).text();
  check(
    'and the Telugu template they had just written survives',
    afterGstin.includes('డ్రాఫ్ట్ పరీక్ష'),
    'the WhatsApp template was discarded with the bad GSTIN',
  );
  // Put settings back the way the suite found them.
  const restoreSettings = await postAction('/settings', extractForm(afterGstin, 'receiptPrefix'), {
    gstin: '',
    waTemplateTe: 'నమస్తే {{member_first_name}}!',
  });
  absorbCookies(restoreSettings);
  check('settings restored', redirectTarget(restoreSettings).includes('msg=saved'));
  check('reception relogin after settings', await loginAs(EMAIL));

  const freshForm = await (await getFollow(`/members/${draftMemberId}/sell`)).text();
  check(
    'and the draft is cleared, so the next sale starts clean',
    !freshForm.includes('TYPO-CODE-42') && !freshForm.includes('UTR-REF-9911'),
    'a finished draft leaked into the next form',
  );

  // ---- a page that cannot be shown says so --------------------------------
  // A 404 in the admin app used to render a completely blank page: no
  // message, no navigation, nothing. A receptionist opening a stale bookmark
  // got a white screen and no way to tell a broken system from their own
  // mistake.
  console.log('\n[when a page cannot be shown]');
  const ghost = '00000000-0000-0000-0000-000000000000';
  const missingMember = await get(`/members/${ghost}`);
  const missingMemberBody = await missingMember.text();
  check(
    'a member that does not exist answers 404, not 200',
    missingMember.status === 404,
    String(missingMember.status),
  );
  check(
    'and explains itself instead of rendering blank',
    missingMemberBody.includes('does not exist'),
  );
  check(
    'without confirming whether the id belongs to another gym',
    !/belongs to (this|that) gym|another gym's member/i.test(missingMemberBody),
  );
  const missingReceipt = await get(`/receipts/${ghost}`);
  check(
    'a receipt that does not exist answers 404 too',
    missingReceipt.status === 404 && (await missingReceipt.text()).includes('does not exist'),
  );
  const nonsense = await get('/no-such-page');
  check('and so does a route that was never a page', nonsense.status === 404);

  // The list pages stream a skeleton, which commits HTTP 200 before the body
  // runs. That is why the skeletons are on the leaf list routes and on an
  // in-page boundary in /members, never on the (app) group: a loading.tsx
  // above members/[id] would silently turn every one of those 404s into 200.
  const membersList = await get('/members');
  check('the members list still answers 200', membersList.status === 200);
  // /members streams its results behind a skeleton, but only AFTER the page
  // has awaited requirePermission — so a staff member without members.view
  // is still turned away by a real redirect rather than handed the shell.
  const savedForForbidden = cookie;
  check('receptionist relogin for the streamed-page check', await loginAs(EMAIL));
  const recepMembers = await get('/members');
  check(
    'and a streamed page still enforces permission with a real redirect',
    recepMembers.status === 200 || redirectTarget(recepMembers).includes('/forbidden'),
    `${recepMembers.status} ${redirectTarget(recepMembers)}`,
  );
  const recepAuditAgain = await get('/audit');
  check(
    'the audit log still turns a receptionist away with a 307, not a 200 shell',
    [302, 303, 307].includes(recepAuditAgain.status) &&
      redirectTarget(recepAuditAgain).includes('/forbidden'),
    `${recepAuditAgain.status} ${redirectTarget(recepAuditAgain)}`,
  );
  cookie = savedForForbidden;

  const teNotFound = await fetch(`${BASE}/no-such-page`, {
    headers: { cookie: `${cookie}; gymflow_lang=te` },
  });
  const teBody = await teNotFound.text();
  check('the not-found page is translated, not English-only', teBody.includes('ఈ పేజీ లేదు'));
  check(
    'and the document language follows, so screen readers get it right',
    teBody.includes('<html lang="te"'),
    teBody.slice(0, 60),
  );

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
  .finally(async () => {
    await restoreOwnerPassword();
    await db.end();
  });
