import { redirect } from 'next/navigation';
import { PRODUCT } from '@gymflow/config';
import { currentUser, logout } from '@/lib/session';

export const dynamic = 'force-dynamic';

async function logoutAction(): Promise<void> {
  'use server';
  await logout();
  redirect('/login');
}

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user || user.kind === 'member') redirect('/login');
  // Gym staff have no business here, and the console is cross-tenant by
  // design: it is the one place RLS is deliberately unscoped.
  if (user.kind !== 'platform_admin') redirect('/forbidden');
  // Already inside a gym: the console is the unscoped view and they are not
  // unscoped. "Leave this gym" is the way back.
  if (user.tenantId) redirect('/');

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-800 bg-slate-900 text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div>
            <span className="text-lg font-bold">{PRODUCT.name}</span>
            <span className="ml-2 rounded bg-amber-400 px-2 py-0.5 text-xs font-bold text-slate-900">
              Platform
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-300">{user.displayName}</span>
            <a href="/account/password" className="text-slate-300 underline hover:text-white">
              Change password
            </a>
            <form action={logoutAction}>
              <button className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-800">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
