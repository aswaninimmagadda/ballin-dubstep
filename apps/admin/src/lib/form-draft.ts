import 'server-only';
import { cookies } from 'next/headers';
import { log } from './log';

/**
 * Keep what the user typed when a submission is rejected.
 *
 * A server action that fails redirects back with `?error=…`, and a redirect
 * re-renders the page from scratch — so by default every field the
 * receptionist filled in is gone. At a busy counter that means retyping a
 * twelve-field form with a member standing there, and the second attempt is
 * where people give up and write it in a notebook instead.
 *
 * The draft is parked in a short-lived http-only cookie rather than echoed
 * through the query string, because these forms carry member personal details
 * and this product's rule is that member data never goes in a URL — not in the
 * access log, not in browser history, not in a Referer header. (The
 * onboarding form has worked this way since the URL leak was fixed; this is
 * that mechanism made reusable.)
 *
 * Scoped two ways so one form's draft can never surface in another's: a
 * distinct cookie name per form, and a cookie `path` limiting which requests
 * even carry it.
 */

/** Never park these in a cookie, http-only or not. */
const NEVER_KEEP =
  /^(password|currentPassword|newPassword|confirmPassword|confirm|csrf|token|digest|csv)$/i;

/**
 * Browsers drop a Set-Cookie over ~4 KB without telling anyone. A draft that
 * would exceed this is not stored at all: losing the draft is a nuisance, but
 * a silently dropped cookie that half-restores a form would be worse.
 *
 * Measured in BYTES, which is what the limit is in. A JavaScript string's
 * .length counts UTF-16 code units, and Telugu costs three UTF-8 bytes per
 * character — so a gym's Telugu WhatsApp template measuring 1,500 by .length
 * is over 4 KB on the wire. Using .length here would have let exactly the
 * Telugu-language drafts through the guard and into the silent drop.
 */
const MAX_DRAFT_BYTES = 3072;

const TTL_SECONDS = 600;

export interface FormDraft {
  /** Save the submitted values. Call immediately before an error redirect. */
  keep(formData: FormData): Promise<void>;
  /** Read them back when re-rendering the form. Empty when there is no draft. */
  read(): Promise<Record<string, string>>;
  /** Drop the draft. Call on success, and when the form is first opened clean. */
  clear(): Promise<void>;
}

/**
 * @param key  short, unique per form — becomes part of the cookie name
 * @param path the concrete URL this form lives at, e.g. `/members/abc/sell`
 */
export function formDraft(key: string, path: string): FormDraft {
  const name = `gymflow_draft_${key}`;
  return {
    async keep(formData: FormData): Promise<void> {
      const entries: Record<string, string> = {};
      for (const [field, value] of formData.entries()) {
        if (typeof value !== 'string') continue;
        if (field.startsWith('$ACTION')) continue;
        if (NEVER_KEEP.test(field)) continue;
        // Empty strings are kept deliberately. On the edit form a blank field
        // means "erase this", not "leave it alone" — dropping empties would
        // restore the value the receptionist had just cleared, and they would
        // have to clear it again without being told why it came back.
        //
        // Absence therefore means "not submitted", which is exactly what an
        // unticked checkbox is, and what draftChecked relies on.
        entries[field] = value;
      }
      const payload = JSON.stringify(entries);
      const bytes = Buffer.byteLength(payload, 'utf8');
      if (bytes > MAX_DRAFT_BYTES) {
        log.warn('form_draft.too_large', { key, bytes });
        return;
      }
      (await cookies()).set(name, payload, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path,
        maxAge: TTL_SECONDS,
      });
    },

    async read(): Promise<Record<string, string>> {
      const raw = (await cookies()).get(name)?.value;
      if (!raw) return {};
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const out: Record<string, string> = {};
        for (const [field, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof value === 'string') out[field] = value;
        }
        return out;
      } catch {
        // A truncated or tampered cookie must not take the page down with it.
        return {};
      }
    },

    async clear(): Promise<void> {
      (await cookies()).delete({ name, path });
    },
  };
}

/**
 * Read a draft, but only when the page was reached from a rejected
 * submission.
 *
 * A draft outlives its redirect: someone whose sale is refused and who then
 * walks away leaves the cookie behind for its full ten minutes. Restoring it
 * on any clean open meant the NEXT person to open that form — possibly for a
 * different member at a shared reception terminal — found an amount and a
 * promo code already filled in that they never typed. Silently pre-filling a
 * money field with a stale value is worse than losing it.
 *
 * The error parameter is the signal: it is present on exactly the redirect
 * the draft was written for. (Clearing the cookie here instead is not an
 * option — Next.js forbids writing cookies during a page render.)
 */
export async function loadDraft(
  key: string,
  path: string,
  error: string | undefined,
): Promise<Record<string, string>> {
  if (!error) return {};
  return formDraft(key, path).read();
}

/**
 * Pick the value for a field: what they typed last, else the current stored
 * value, else empty. Reads as `defaultValue={draftOr(draft, 'amount', quote)}`
 * at the call site, which is the whole point — restoring a draft should not
 * make a form harder to read.
 */
export function draftOr(
  draft: Record<string, string>,
  field: string,
  fallback: string | number | null | undefined = '',
): string {
  const kept = draft[field];
  if (kept !== undefined) return kept;
  return fallback === null || fallback === undefined ? '' : String(fallback);
}

/** Was this checkbox ticked? A checkbox absent from a draft was unticked. */
export function draftChecked(
  draft: Record<string, string>,
  field: string,
  fallback = false,
): boolean {
  if (Object.keys(draft).length === 0) return fallback;
  return draft[field] !== undefined;
}
