import { redirect } from 'next/navigation';
import { hasPermission } from '@gymflow/core';
import { isValidIndianMobile, normalizeIndianMobile } from '@gymflow/utils';
import { requirePermission } from '@/lib/session';
import { createTrainer, listTrainers, setTrainerActive } from '@/lib/services/trainers';
import { asPrincipal } from '@/lib/db';
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

async function createTrainerAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('trainers.manage');
  const rawMobile = String(formData.get('mobile') ?? '');
  if (!isValidIndianMobile(rawMobile)) {
    redirect(`/trainers?error=${encodeURIComponent('Enter a valid 10-digit mobile number.')}`);
  }
  try {
    await createTrainer(user, {
      branchId: String(formData.get('branchId')),
      name: String(formData.get('name')).trim(),
      mobile: normalizeIndianMobile(rawMobile).e164,
      specialization: String(formData.get('specialization') ?? '').trim() || null,
    });
  } catch (err) {
    redirect(`/trainers?error=${encodeURIComponent(toUserMessage(err))}`);
  }
  redirect('/trainers');
}

async function toggleTrainerAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('trainers.manage');
  await setTrainerActive(user, String(formData.get('id')), formData.get('active') === '1');
  redirect('/trainers');
}

export default async function TrainersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requirePermission('trainers.view');
  const { error } = await searchParams;
  const tr = await t();
  const trainers = await listTrainers(user);
  const canManage =
    hasPermission(user.permissions, 'trainers.manage') || user.kind === 'platform_admin';
  const branches = await asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(`SELECT id, name FROM branches WHERE is_active ORDER BY name`);
    return r.rows as { id: string; name: string }[];
  });

  return (
    <>
      <PageHeader title={tr.nav.trainers} />
      <ErrorBanner message={error ?? null} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Table
            headers={[
              tr.members.name,
              'Branch',
              'Specialization',
              'Members',
              'Sessions',
              tr.members.status,
              '',
            ]}
          >
            {trainers.map((x) => (
              <tr key={x.id}>
                <td className="px-4 py-3 font-medium">
                  {x.name}
                  <span className="block text-xs text-slate-400">
                    {x.mobile.replace('+91', '')}
                  </span>
                </td>
                <td className="px-4 py-3">{x.branch_name}</td>
                <td className="px-4 py-3 text-slate-500">{x.specialization ?? '—'}</td>
                <td className="px-4 py-3">{x.assigned_members}</td>
                <td className="px-4 py-3">{x.upcoming_sessions}</td>
                <td className="px-4 py-3">
                  <Badge tone={x.is_active ? 'success' : 'muted'}>
                    {x.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  {canManage ? (
                    <form action={toggleTrainerAction}>
                      <input type="hidden" name="id" value={x.id} />
                      <input type="hidden" name="active" value={x.is_active ? '0' : '1'} />
                      <button className="text-xs font-semibold text-slate-500 hover:text-slate-700">
                        {x.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        </div>

        {canManage ? (
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-slate-700">New trainer</h2>
            <form action={createTrainerAction} className="space-y-3">
              <Field label={tr.members.name} required>
                <input name="name" required className={inputCls} />
              </Field>
              <Field label={tr.members.mobile} required>
                <input name="mobile" type="tel" required className={inputCls} />
              </Field>
              <Field label={tr.ui.branch} required>
                <select name="branchId" className={inputCls}>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={tr.ui.specialization}>
                <input
                  name="specialization"
                  placeholder={tr.ui.strengthWeightLossZumba}
                  className={inputCls}
                />
              </Field>
              <Button className="w-full">{tr.common.save}</Button>
            </form>
          </Card>
        ) : null}
      </div>
    </>
  );
}
