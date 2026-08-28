#!/usr/bin/env node
/**
 * Day-one scenario: a gym provisioned five minutes ago with ZERO data —
 * no members, no plans, no payments, no attendance. Every screen must still
 * render, and every export must still produce a file. Empty-state crashes
 * are invisible to the seeded suites, which always have data.
 *
 * Usage: node scripts/e2e-empty-tenant.mjs [slug] [ownerPassword]
 * With no arguments it provisions its own throw-away tenant.
 */
import { execFileSync } from 'node:child_process';

const BASE = process.env.E2E_BASE ?? 'http://localhost:3000';
let SLUG = process.argv[2];
let PW = process.argv[3];

if (!SLUG || !PW) {
  SLUG = `empty${process.pid.toString(36)}`;
  const out = execFileSync(
    'pnpm',
    [
      '--filter',
      '@gymflow/database',
      'create-tenant',
      '--',
      '--slug',
      SLUG,
      '--name',
      'Empty Gym (smoke)',
      '--owner-email',
      `owner@${SLUG}.test`,
      '--receipt-prefix',
      'EMP',
    ],
    { encoding: 'utf8' },
  );
  PW = out.match(/shown once\): (\S+)/)?.[1];
  if (!PW) throw new Error('could not provision the throw-away tenant');
  console.log(`Provisioned empty tenant "${SLUG}"`);
}
let cookie = '';
let pass = 0;
const fails = [];
const check = (n, c, d = '') =>
  c ? (pass++, console.log('  ✓', n)) : (fails.push(n), console.error('  ✗', n, d));
const get = (p) => fetch(BASE + p, { headers: { cookie }, redirect: 'manual' });
function extractForm(html, marker) {
  for (const f of html.split('<form').slice(1)) {
    if (!f.includes(`name="${marker}"`)) continue;
    const actionId = f.match(/\$ACTION_ID_([a-f0-9]+)/)?.[1];
    const hidden = {};
    for (const m of f.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g))
      if (!m[1].startsWith('$ACTION')) hidden[m[1]] = m[2];
    return { actionId, hidden };
  }
  throw new Error('no form ' + marker);
}
const login = async (email, password) => {
  cookie = '';
  const form = extractForm(await (await get('/login')).text(), 'email');
  const fd = new FormData();
  fd.set(`$ACTION_ID_${form.actionId}`, '');
  for (const [k, v] of Object.entries({ ...form.hidden, email, password })) fd.set(k, v);
  const r = await fetch(BASE + '/login', { method: 'POST', body: fd, redirect: 'manual' });
  cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  return cookie.startsWith('gymflow_session=');
};
check('owner can sign in to the empty gym', await login(`owner@${SLUG}.test`, PW));
// Assert POSITIVELY: the page must contain its own heading text. Next's RSC
// payload always contains the string "digest", so scanning for it is useless.
const PAGES = [
  ['/', 'Dashboard'],
  ['/members', 'Members'],
  ['/members/new', 'New member'],
  ['/attendance', 'Attendance'],
  ['/payments', 'Payments'],
  ['/leads', 'Leads'],
  ['/plans', 'Plans'],
  ['/promotions', 'Promotions'],
  ['/trainers', 'Trainers'],
  ['/staff', 'Staff'],
  ['/reports', 'Reports'],
  ['/settings', 'Settings'],
  ['/audit', 'Activity'],
  ['/members/import', 'Import'],
];
for (const [p, marker] of PAGES) {
  const res = await fetch(BASE + p, { headers: { cookie }, redirect: 'follow' });
  const body = await res.text();
  // Judge on the status and the page's own heading only. A Next.js document
  // legitimately embeds "digest", "error" and the 404 string in its RSC
  // payload and client bundle, so scanning the body for those words reports
  // failures that are not there.
  const crashed = res.status >= 500;
  check(
    `${p} renders for an empty gym`,
    res.status === 200 && !crashed && body.includes(marker),
    `${res.status} marker=${body.includes(marker)}`,
  );
}
for (const k of ['members', 'memberships', 'payments', 'attendance', 'dues']) {
  const res = await fetch(`${BASE}/api/export/${k}`, { headers: { cookie } });
  check(`export ${k} works with no data`, res.status === 200, String(res.status));
}
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.error('FAILURES:', fails.join(' | '));
  process.exitCode = 1;
}
