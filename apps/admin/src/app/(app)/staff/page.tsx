import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/session';
import { listAssignableRoles, listStaff, setStaffActive } from '@/lib/services/staff';
import { toUserMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Field,
  PageHeader,
  Table,
  inputCls,
} from '@/components/ui';

export const dynamic = 'force-dynamic';

async function toggleActiveAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('staff.manage');
  try {
    await setStaffActive(user, String(formData.get('userId')), formData.get('active') === '1');
  } catch (err) {
    redirect(`/staff?error=${encodeURIComponent(toUserMessage(err))}`);
  }
  redirect('/staff');
}

/**
 * A role's name in the reader's language.
 *
 * roles.name holds an English display name written at provisioning time,
 * and a Telugu-speaking owner was reading "Branch Manager" in the middle of
 * an otherwise Telugu page. roles.key is the stable machine name, so the
 * six system roles come from the translations; anything a gym adds itself
 * has no key we ship and keeps the name the gym gave it, which is the right
 * answer for a name they chose.
 */
function roleLabel(
  tr: { ui: { roleNames: Record<string, string> } },
  key: string | null | undefined,
  name: string | null | undefined,
): string {
  if (key && Object.hasOwn(tr.ui.roleNames, key)) return tr.ui.roleNames[key] as string;
  return name ?? '—';
}

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requirePermission('staff.manage');
  const { error } = await searchParams;
  const tr = await t();
  const [staff, roles] = await Promise.all([listStaff(user), listAssignableRoles(user)]);

  return (
    <>
      <PageHeader title={tr.ui.staff} subtitle={tr.ui.subStaff} />
      <ErrorBanner message={error ?? null} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Table headers={[tr.ui.name, tr.auth.email, tr.ui.role, tr.members.status, '']}>
            {staff.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-3 font-medium">{s.display_name}</td>
                <td className="px-4 py-3 text-slate-500">{s.email}</td>
                <td className="px-4 py-3">{roleLabel(tr, s.role_key, s.role_name)}</td>
                <td className="px-4 py-3">
                  <Badge tone={s.is_active ? 'success' : 'muted'}>
                    {s.is_active ? tr.members.statuses.active : tr.ui.deactivated}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  {s.id !== user.userId ? (
                    <div className="flex gap-2">
                      <form action={toggleActiveAction}>
                        <input type="hidden" name="userId" value={s.id} />
                        <input type="hidden" name="active" value={s.is_active ? '0' : '1'} />
                        <button className="text-xs font-semibold text-slate-500 hover:text-slate-700">
                          {s.is_active ? tr.ui.deactivate : tr.ui.reactivate}
                        </button>
                      </form>
                      <form action="/credentials" method="post">
                        <input type="hidden" name="kind" value="staff_reset" />
                        <input type="hidden" name="userId" value={s.id} />
                        <button className="text-xs font-semibold text-slate-500 hover:text-slate-700">
                          {tr.ui.resetPassword}
                        </button>
                      </form>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500">you</span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </div>

        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">{tr.ui.newStaffAccount}</h2>
          <form action="/credentials" method="post" className="space-y-3">
            <input type="hidden" name="kind" value="staff_create" />
            <Field label={tr.members.name} required>
              <input name="displayName" required className={inputCls} />
            </Field>
            <Field label={tr.auth.email} required>
              <input name="email" type="email" required className={inputCls} />
            </Field>
            <Field label={tr.ui.role} required>
              <select name="roleId" required className={inputCls}>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {roleLabel(tr, r.key, r.name)}
                  </option>
                ))}
              </select>
            </Field>
            <Button className="w-full">{tr.common.save}</Button>
            <p className="text-xs text-slate-500">{tr.ui.oneTimePasswordNote}</p>
          </form>
        </Card>
      </div>
    </>
  );
}
