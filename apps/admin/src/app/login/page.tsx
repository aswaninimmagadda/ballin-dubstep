import { redirect } from 'next/navigation';
import { PRODUCT } from '@gymflow/config';
import { staffLoginSchema } from '@gymflow/validation';
import { loginStaff, currentUser } from '@/lib/session';
import { t } from '@/lib/i18n';
import { Button, ErrorBanner, Field, inputCls } from '@/components/ui';

export const dynamic = 'force-dynamic';

async function loginAction(formData: FormData): Promise<void> {
  'use server';
  const parsed = staffLoginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) redirect('/login?error=invalid');
  const result = await loginStaff(parsed.data.email, parsed.data.password);
  if (!result.ok) redirect(`/login?error=${result.reason}`);
  redirect('/');
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentUser();
  if (user && user.kind !== 'member') redirect('/');
  const { error } = await searchParams;
  const tr = await t();
  const errorMessages: Record<string, string> = {
    invalid: tr.auth.invalidCredentials,
    locked: tr.auth.accountLocked,
    inactive: tr.auth.invalidCredentials,
    tenant_suspended: 'This gym account is suspended. Contact support.',
  };
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
        <h1 className="text-center text-2xl font-bold text-primary">{PRODUCT.name}</h1>
        <p className="mt-1 text-center text-sm text-slate-500">{tr.auth.signIn}</p>
        <ErrorBanner message={error ? (errorMessages[error] ?? tr.common.error) : null} />
        <form action={loginAction} className="mt-6 space-y-4">
          <Field label={tr.auth.email} required>
            <input name="email" type="email" autoComplete="email" required className={inputCls} />
          </Field>
          <Field label={tr.auth.password} required>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              className={inputCls}
            />
          </Field>
          <Button className="w-full">{tr.auth.signIn}</Button>
        </form>
      </div>
    </main>
  );
}
