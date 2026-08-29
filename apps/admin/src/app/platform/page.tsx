import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { formatDisplayDate } from '@gymflow/utils';
import { requireUser, PLATFORM_SCOPE_COOKIE } from '@/lib/session';
import { listTenants, enterTenant } from '@/lib/services/platform';
import { toUserMessage } from '@/lib/errors';
import {
  Badge,
  Card,
  ErrorBanner,
  PageHeader,
  statusTone,
  Table,
  EmptyState,
} from '@/components/ui';

export const dynamic = 'force-dynamic';

async function enterAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requireUser();
  const tenantId = String(formData.get('tenantId') ?? '');
  try {
    await enterTenant(user, tenantId);
  } catch (err) {
    redirect(`/platform?error=${encodeURIComponent(toUserMessage(err))}`);
  }
  // Scope the session to this gym. From here on RLS itself refuses every
  // other gym's rows (migration 0022), so the operational screens can be
  // trusted to be about one gym and one gym only.
  (await cookies()).set(PLATFORM_SCOPE_COOKIE, tenantId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  redirect('/');
}

export default async function PlatformPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const tenants = await listTenants(user);
  const totals = tenants.reduce(
    (acc, t) => ({
      members: acc.members + t.members,
      active: acc.active + t.active_memberships,
    }),
    { members: 0, active: 0 },
  );

  return (
    <>
      <PageHeader
        title="Gyms on this platform"
        subtitle={`${tenants.length} gyms · ${totals.members} members · ${totals.active} active memberships`}
      />
      <ErrorBanner message={sp.error} />
      <Card>
        <p className="mb-4 text-sm text-slate-600">
          Open a gym to work inside it. Everything outside the gym you open stays out of reach for
          the rest of your session — the boundary is enforced by the database, not by this screen.
        </p>
        {tenants.length === 0 ? (
          <EmptyState
            title="No gyms yet"
            hint="Provision one with the operator CLI: pnpm run manage-tenant."
          />
        ) : (
          <Table
            headers={[
              'Gym',
              'Status',
              'Plan',
              'Branches',
              'Staff',
              'Members',
              'Active',
              'Last payment',
              '',
            ]}
          >
            {tenants.map((t) => (
              <tr key={t.id} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-900">{t.name}</div>
                  <div className="text-xs text-slate-500">{t.slug}</div>
                </td>
                <td className="px-3 py-2">
                  <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                </td>
                <td className="px-3 py-2 text-slate-600">{t.subscription_tier}</td>
                <td className="px-3 py-2 tabular-nums text-slate-600">{t.branches}</td>
                <td className="px-3 py-2 tabular-nums text-slate-600">{t.staff}</td>
                <td className="px-3 py-2 tabular-nums text-slate-600">{t.members}</td>
                <td className="px-3 py-2 tabular-nums text-slate-600">{t.active_memberships}</td>
                <td className="px-3 py-2 text-slate-600">
                  {t.last_activity ? formatDisplayDate(t.last_activity.slice(0, 10)) : '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  <form action={enterAction}>
                    <input type="hidden" name="tenantId" value={t.id} />
                    <button className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90">
                      Open
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
