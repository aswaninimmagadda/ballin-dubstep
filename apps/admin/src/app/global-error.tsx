'use client';
import { getTranslations } from '@gymflow/i18n';

/**
 * The last resort: the root layout itself threw, so no layout renders and
 * this must supply its own <html> and <body>.
 *
 * It cannot read <html lang> — that is the element this component is
 * replacing — and it cannot import the app's CSS reliably at this point, so
 * the styling is inline and the copy is bilingual rather than switched. A
 * receptionist seeing this needs to know it is not their fault and what to
 * quote when they ring; both languages on one screen is the honest way to do
 * that when the machinery for choosing has itself failed.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const en = getTranslations('en').errors;
  const te = getTranslations('te').errors;
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
          margin: 0,
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f8fafc',
          color: '#0f172a',
        }}
      >
        <div style={{ maxWidth: 420, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>{en.errorTitle}</h1>
          <p style={{ fontSize: 14, color: '#475569', margin: '0 0 4px' }}>{en.errorBody}</p>
          {/* lang="te" so a screen reader switches voice rather than reading
              Telugu with English phonetics. */}
          <h2 lang="te" style={{ fontSize: 16, margin: '16px 0 8px', fontWeight: 600 }}>
            {te.errorTitle}
          </h2>
          <p lang="te" style={{ fontSize: 14, color: '#475569', margin: '0 0 20px' }}>
            {te.errorBody}
          </p>
          {error.digest ? (
            <p style={{ fontSize: 12, color: '#475569', margin: '0 0 20px' }}>
              {en.errorReference}: <code style={{ fontWeight: 600 }}>{error.digest}</code>
            </p>
          ) : null}
          <button
            onClick={reset}
            style={{
              background: '#15803d',
              color: '#fff',
              border: 0,
              borderRadius: 10,
              padding: '12px 24px',
              fontSize: 15,
              fontWeight: 600,
              minHeight: 44,
              cursor: 'pointer',
            }}
          >
            {getTranslations('en').common.retry} · {getTranslations('te').common.retry}
          </button>
        </div>
      </body>
    </html>
  );
}
