import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { changeOwnPassword } from '@/lib/services/account';
import { toUserMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { Button, Card, ErrorBanner, Field, PageHeader, inputCls } from '@/components/ui';

export const dynamic = 'force-dynamic';

async function changeAction(formData: FormData): Promise<void> {
  'use server';
  const user = await currentUser();
  if (!user || user.kind === 'member') redirect('/login');
  const next = String(formData.get('newPassword') ?? '');
  if (next !== String(formData.get('confirmPassword') ?? '')) {
    redirect(
      `/account/password?error=${encodeURIComponent('The two new passwords do not match.')}`,
    );
  }
  try {
    await changeOwnPassword(user, String(formData.get('currentPassword') ?? ''), next);
  } catch (err) {
    if ((err as { digest?: string }).digest?.startsWith('NEXT_REDIRECT')) throw err;
    redirect(`/account/password?error=${encodeURIComponent(toUserMessage(err))}`);
  }
  // Every session was revoked, this one included — sign in with the new one.
  redirect('/login?msg=password_changed');
}

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; msg?: string }>;
}) {
  const user = await currentUser();
  if (!user || user.kind === 'member') redirect('/login');
  const { error, msg } = await searchParams;
  const tr = await t();
  const forced = msg === 'must_change' || user.mustChangePassword;

  return (
    <>
      <PageHeader
        title={tr.auth.changePassword}
        subtitle={`${user.displayName} — you will be signed out and asked to sign in again.`}
      />
      <ErrorBanner message={error ?? null} />
      {/* Reached by redirect from every other page while the one-time password
          is still in use, so say why rather than looking like a dead end. */}
      {forced ? (
        <p
          role="status"
          className="mb-4 max-w-md rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          {tr.auth.mustChangePassword}
        </p>
      ) : null}
      <Card className="max-w-md">
        <form action={changeAction} className="space-y-4">
          <Field label={tr.auth.currentPassword} required>
            <input
              type="password"
              name="currentPassword"
              required
              autoComplete="current-password"
              className={inputCls}
            />
          </Field>
          <Field label={tr.auth.newPassword} required>
            <input
              type="password"
              name="newPassword"
              required
              minLength={10}
              autoComplete="new-password"
              className={inputCls}
            />
          </Field>
          <Field label={tr.auth.confirmPassword} required>
            <input
              type="password"
              name="confirmPassword"
              required
              minLength={10}
              autoComplete="new-password"
              className={inputCls}
            />
          </Field>
          <p className="text-xs text-slate-500">
            At least 10 characters. Change the one-time password you were given at the desk the
            first time you sign in.
          </p>
          <Button>{tr.auth.changePassword}</Button>
        </form>
      </Card>
    </>
  );
}
