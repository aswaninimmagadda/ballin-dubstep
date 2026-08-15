import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { PRODUCT } from '@gymflow/config';
import { requireUser, logout } from '@/lib/session';
import { t, LANG_COOKIE, currentLanguage } from '@/lib/i18n';
import { PwaSetup } from '@/components/pwa';
import { tenantFlags } from '@/lib/flags';

export const dynamic = 'force-dynamic';

async function logoutAction(): Promise<void> {
  'use server';
  await logout();
  redirect('/login');
}

async function setLanguageAction(formData: FormData): Promise<void> {
  'use server';
  const lang = formData.get('lang');
  if (lang === 'en' || lang === 'te') {
    (await cookies()).set(LANG_COOKIE, lang, { path: '/', maxAge: 60 * 60 * 24 * 365 });
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const tr = await t();
  const lang = await currentLanguage();
  const flags = await tenantFlags(user);

  const nav = [
    { href: '/', label: tr.nav.dashboard },
    { href: '/members', label: tr.nav.members },
    ...(flags.attendance ? [{ href: '/attendance', label: tr.nav.attendance }] : []),
    { href: '/payments', label: tr.nav.payments },
    ...(flags.leads ? [{ href: '/leads', label: tr.nav.leads }] : []),
    { href: '/plans', label: tr.nav.plans },
    { href: '/promotions', label: tr.nav.promotions },
    { href: '/trainers', label: tr.nav.trainers },
    { href: '/staff', label: tr.nav.staff },
    { href: '/reports', label: tr.nav.reports },
    { href: '/settings', label: tr.nav.settings },
    { href: '/audit', label: tr.nav.audit },
  ];

  return (
    <div className="min-h-screen">
      <PwaSetup offlineText={tr.common.offline} />
      <header className="no-print sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="text-lg font-bold text-primary">
            {PRODUCT.name}
          </Link>
          <nav className="hidden gap-1 overflow-x-auto md:flex" aria-label="Main">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <form action={setLanguageAction}>
              <input type="hidden" name="lang" value={lang === 'en' ? 'te' : 'en'} />
              <button
                className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                title={tr.common.language}
              >
                {lang === 'en' ? 'తెలుగు' : 'English'}
              </button>
            </form>
            <span className="hidden text-sm text-slate-500 sm:inline">{user.displayName}</span>
            <form action={logoutAction}>
              <button className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100">
                {tr.common.signOut}
              </button>
            </form>
          </div>
        </div>
        {/* Mobile nav */}
        <nav
          className="flex gap-1 overflow-x-auto border-t border-slate-100 px-2 py-1 md:hidden"
          aria-label="Main mobile"
        >
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
