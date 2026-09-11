'use client';
import { useEffect } from 'react';
import { clientTranslations } from '@/lib/i18n-client';
import { BoundaryMessage } from '@/components/boundary';

/**
 * A page threw. React requires this boundary to be a client component, so it
 * reads the language off <html lang> rather than the async server resolver
 * (see lib/i18n-client.ts) — an error page only half this product's users can
 * read is not much of an error page.
 *
 * `digest` is Next's own hash of the server-side error. The same value is in
 * the server log line for that request, which is what makes "it said
 * something went wrong" answerable.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const tr = clientTranslations();

  useEffect(() => {
    // The server already logged this; this is the browser half, and the only
    // record of faults that happen during client navigation.
    console.error('[gymflow] page error', error.digest ?? '', error.message);
  }, [error]);

  return (
    <BoundaryMessage
      title={tr.errors.errorTitle}
      body={tr.errors.errorBody}
      reference={error.digest}
      referenceLabel={tr.errors.errorReference}
    >
      <button
        onClick={reset}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
      >
        {tr.common.retry}
      </button>
      <a
        href="/"
        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        {tr.errors.notFoundAction}
      </a>
    </BoundaryMessage>
  );
}
