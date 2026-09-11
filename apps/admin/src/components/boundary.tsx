import Link from 'next/link';
import type { TranslationTree } from '@gymflow/i18n';

/**
 * What a staff member sees when a page cannot be shown.
 *
 * Until this existed, a 404 in the admin app rendered a completely blank
 * page — no message, no navigation, nothing. A receptionist opening a stale
 * bookmark, or a member link from before that member was archived, got a
 * white screen and no idea whether the system was broken or they had done
 * something wrong.
 *
 * Plain markup, no client JS, so it works from both a server not-found and a
 * client error boundary.
 */
export function BoundaryMessage({
  title,
  body,
  reference,
  referenceLabel,
  children,
}: {
  title: string;
  body: string;
  reference?: string;
  referenceLabel?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      <p className="mx-auto mt-3 max-w-md text-sm text-slate-600">{body}</p>
      {reference ? (
        <p className="mt-4 text-xs text-slate-600">
          {referenceLabel}: <code className="font-mono font-semibold">{reference}</code>
        </p>
      ) : null}
      <div className="mt-6 flex flex-wrap justify-center gap-2">{children}</div>
    </div>
  );
}

export function BoundaryLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-dark"
    >
      {label}
    </Link>
  );
}

export function NotFoundBody({ tr }: { tr: TranslationTree }) {
  return (
    <BoundaryMessage title={tr.errors.notFoundTitle} body={tr.errors.notFoundBody}>
      <BoundaryLink href="/" label={tr.errors.notFoundAction} />
    </BoundaryMessage>
  );
}

/**
 * A page-shaped grey skeleton, shown while a server component is still
 * awaiting its queries — so a slow page looks like it is working rather than
 * like a frozen browser, which matters most on the tethered connection a
 * small gym actually runs on.
 *
 * Use it ONLY as an in-page <Suspense fallback>, placed after the page has
 * awaited requirePermission(). Never as a route-level loading.tsx.
 *
 * A loading.tsx wraps its whole subtree in a Suspense boundary, and Next then
 * streams those routes: the HTML shell is flushed with HTTP 200 before the
 * page body runs. After that flush the server can no longer set a status or a
 * Location header, so two things break silently —
 *
 *   - notFound() stops producing 404. Every members/[id] page calls it for a
 *     member that does not exist or belongs to another gym; those all became
 *     200s.
 *   - redirect() stops producing 307. Every page in (app) calls
 *     requirePermission(), which redirects to /forbidden, /login, or the
 *     change-password page. A receptionist opening the audit log got the page
 *     shell instead of being turned away.
 *
 * Both were caught by the acceptance suite rather than by reading the docs,
 * which is the only reason this comment exists.
 */
export function PageSkeleton({ rows = 6, label }: { rows?: number; label?: string }) {
  return (
    // The grey bars themselves are decoration and stay hidden, but the fact
    // that something is loading has to reach a screen reader too — otherwise
    // the new "it looks like it is working" feedback reaches only people who
    // can see it.
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label ?? 'Loading…'}</span>
      <div className="animate-pulse" aria-hidden="true">
        <div className="mb-6 h-8 w-52 rounded bg-slate-200" />
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <div className="h-20 rounded-xl bg-slate-200" />
          <div className="h-20 rounded-xl bg-slate-200" />
          <div className="h-20 rounded-xl bg-slate-200" />
        </div>
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="h-10 rounded bg-slate-100" />
          ))}
        </div>
      </div>
    </div>
  );
}
