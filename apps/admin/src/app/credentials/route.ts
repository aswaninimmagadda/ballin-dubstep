import { NextResponse, type NextRequest } from 'next/server';
import { hasPermission } from '@gymflow/core';
import { currentUser } from '@/lib/session';
import { createStaff, resetStaffPassword } from '@/lib/services/staff';
import { enableMemberApp } from '@/lib/services/members';
import { toUserMessage } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * One-time credential issuance. This is a POST-rendered page (not a
 * redirect) so generated passwords never appear in URLs, access logs or
 * browser history.
 *
 * Unlike every mutation in the app shell, this is a plain route handler, so it
 * does not get the origin check Next applies to server actions. The session
 * cookie being SameSite=Lax does stop a cross-site form post from carrying it,
 * but that is one browser default standing alone in front of the highest
 * privilege operation in the product — issuing and resetting passwords — so
 * the check is made explicitly here as well.
 */
function sameOrigin(req: NextRequest): boolean {
  // Sec-Fetch-Site is set by every browser that can make this request and is
  // not settable from script; Origin is the fallback for anything older.
  const site = req.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin' || site === 'none';
  const origin = req.headers.get('origin');
  if (!origin) return true; // non-browser client; the session cookie still gates it
  try {
    return new URL(origin).host === (req.headers.get('host') ?? new URL(req.url).host);
  } catch {
    return false;
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function page(title: string, bodyHtml: string, backHref: string, backLabel: string): NextResponse {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>
 body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#f8fafc;color:#0f172a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
 .card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;max-width:420px;width:100%}
 h1{font-size:18px;margin:0 0 12px} p{font-size:14px;color:#475569;margin:0 0 8px}
 code{display:block;background:#f1f5f9;border:1px dashed #94a3b8;border-radius:10px;padding:14px;font-size:20px;font-weight:700;text-align:center;margin:16px 0;user-select:all}
 a{display:inline-block;margin-top:12px;background:#16a34a;color:#fff;text-decoration:none;border-radius:10px;padding:12px 20px;font-size:14px;font-weight:600;min-height:44px;box-sizing:border-box}
 .warn{font-size:12px;color:#b45309}
</style></head><body><div class="card"><h1>${esc(title)}</h1>${bodyHtml}
<a href="${esc(backHref)}">${esc(backLabel)}</a></div></body></html>`;
  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

function errorPage(message: string, backHref: string): NextResponse {
  return page('Could not complete', `<p>${esc(message)}</p>`, backHref, 'Back');
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return new NextResponse('Cross-origin request refused', { status: 403 });
  }
  const user = await currentUser();
  if (!user || user.kind === 'member') {
    return NextResponse.redirect(new URL('/login', req.url), 303);
  }
  const form = await req.formData();
  const kind = String(form.get('kind') ?? '');
  const isPlatform = user.kind === 'platform_admin';

  try {
    if (kind === 'staff_create') {
      if (!isPlatform && !hasPermission(user.permissions, 'staff.manage')) {
        return errorPage('You do not have permission to manage staff.', '/staff');
      }
      const email = String(form.get('email') ?? '')
        .trim()
        .toLowerCase();
      const displayName = String(form.get('displayName') ?? '').trim();
      const roleId = String(form.get('roleId') ?? '');
      if (
        !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ||
        email.length > 254 ||
        !displayName ||
        displayName.length > 200
      ) {
        return errorPage('Check the staff details.', '/staff');
      }
      const result = await createStaff(user, { email, displayName, roleId });
      return page(
        'Staff account created',
        `<p>${esc(displayName)} · ${esc(email)}</p>
         <p>One-time password — share it now, it is not shown again:</p>
         <code>${esc(result.initialPassword)}</code>
         <p class="warn">Ask them to change it after first sign-in.</p>`,
        '/staff',
        'Back to staff',
      );
    }

    if (kind === 'staff_reset') {
      if (!isPlatform && !hasPermission(user.permissions, 'staff.manage')) {
        return errorPage('You do not have permission to manage staff.', '/staff');
      }
      const userId = String(form.get('userId') ?? '');
      const pw = await resetStaffPassword(user, userId);
      return page(
        'Password reset',
        `<p>All of their sessions have been signed out.</p>
         <p>One-time password — share it now, it is not shown again:</p>
         <code>${esc(pw)}</code>`,
        '/staff',
        'Back to staff',
      );
    }

    if (kind === 'member_app') {
      if (!isPlatform && !hasPermission(user.permissions, 'members.edit')) {
        return errorPage('You do not have permission to edit members.', '/members');
      }
      const memberId = String(form.get('memberId') ?? '');
      const result = await enableMemberApp(user, memberId);
      return page(
        'Member app enabled',
        `<p>Gym code: <strong>${esc(result.gymCode)}</strong> · Mobile: their registered number</p>
         <p>One-time password — share it now, it is not shown again:</p>
         <code>${esc(result.password)}</code>`,
        `/members/${encodeURIComponent(memberId)}`,
        'Back to member',
      );
    }

    return errorPage('Unknown request.', '/');
  } catch (err) {
    return errorPage(toUserMessage(err), kind === 'member_app' ? '/members' : '/staff');
  }
}
