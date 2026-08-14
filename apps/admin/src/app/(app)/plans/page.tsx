import { redirect } from 'next/navigation';
import { formatMoney, parseMoney } from '@gymflow/utils';
import { createPlanSchema } from '@gymflow/validation';
import { requirePermission } from '@/lib/session';
import { hasPermission } from '@gymflow/core';
import { createPlan, listPlans, setPlanActive } from '@/lib/services/plans';
import { createAddonPackage, listAddonPackages } from '@/lib/services/addons';
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

async function createPlanAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('plans.manage');
  let basePrice = 0;
  let joiningFee = 0;
  try {
    basePrice = parseMoney(String(formData.get('basePrice') ?? '0'));
    joiningFee = String(formData.get('joiningFee') ?? '').trim()
      ? parseMoney(String(formData.get('joiningFee')))
      : 0;
  } catch {
    redirect(`/plans?error=${encodeURIComponent('Enter valid prices, e.g. 2500')}`);
  }
  const parsed = createPlanSchema.safeParse({
    name: String(formData.get('name')),
    publicDescription: String(formData.get('publicDescription') ?? '') || null,
    displayOrder: 100,
    tags: [],
    terms: {
      durationUnit: String(formData.get('durationUnit')),
      durationValue: Number(formData.get('durationValue')),
      basePrice,
      joiningFee,
      taxRateBps: 0,
      taxInclusive: true,
      freezeAllowanceDays: Number(formData.get('freezeAllowanceDays') ?? 0),
      maxFreezes: Number(formData.get('maxFreezes') ?? 0),
      gracePeriodDays: Number(formData.get('gracePeriodDays') ?? 3),
      allowedTimings: String(formData.get('allowedTimings') ?? '') || null,
    },
  });
  if (!parsed.success) redirect(`/plans?error=${encodeURIComponent('Check the plan details.')}`);
  try {
    await createPlan(user, parsed.data);
  } catch (err) {
    redirect(`/plans?error=${encodeURIComponent(toUserMessage(err))}`);
  }
  redirect('/plans');
}

async function toggleActiveAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('plans.manage');
  await setPlanActive(user, String(formData.get('planId')), formData.get('active') === '1');
  redirect('/plans');
}

async function createAddonAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('plans.manage');
  let price = 0;
  try {
    price = parseMoney(String(formData.get('price') ?? ''));
  } catch {
    redirect(`/plans?error=${encodeURIComponent('Enter a valid package price, e.g. 2000')}`);
  }
  const sessionsRaw = String(formData.get('sessionCount') ?? '').trim();
  try {
    await createAddonPackage(user, {
      kind: String(formData.get('kind')),
      name: String(formData.get('name')).trim(),
      sessionCount: sessionsRaw ? Number(sessionsRaw) : null,
      validityDays: Number(formData.get('validityDays')),
      price,
    });
  } catch (err) {
    redirect(`/plans?error=${encodeURIComponent(toUserMessage(err))}`);
  }
  redirect('/plans');
}

export default async function PlansPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requirePermission('plans.view');
  const { error } = await searchParams;
  const tr = await t();
  const [plans, addonPackages] = await Promise.all([
    listPlans(user, true),
    listAddonPackages(user, true),
  ]);
  const canManage =
    hasPermission(user.permissions, 'plans.manage') || user.kind === 'platform_admin';

  return (
    <>
      <PageHeader
        title={tr.nav.plans}
        subtitle="Price changes create a new version — past sales keep their original terms."
      />
      <ErrorBanner message={error ?? null} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Table
            headers={[
              tr.members.plan,
              tr.membership.duration,
              tr.membership.price,
              tr.membership.joiningFee,
              'Version',
              tr.members.status,
              '',
            ]}
          >
            {plans.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3 font-medium">{p.name}</td>
                <td className="px-4 py-3">
                  {p.duration_value} {p.duration_unit}
                </td>
                <td className="px-4 py-3">{formatMoney(Number(p.base_price))}</td>
                <td className="px-4 py-3">
                  {Number(p.joining_fee) > 0 ? formatMoney(Number(p.joining_fee)) : '—'}
                </td>
                <td className="px-4 py-3 text-slate-500">v{p.version}</td>
                <td className="px-4 py-3">
                  <Badge tone={p.is_active ? 'success' : 'muted'}>
                    {p.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  {canManage ? (
                    <form action={toggleActiveAction}>
                      <input type="hidden" name="planId" value={p.id} />
                      <input type="hidden" name="active" value={p.is_active ? '0' : '1'} />
                      <button className="text-xs font-semibold text-slate-500 hover:text-slate-700">
                        {p.is_active ? 'Deactivate' : 'Activate'}
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
            <h2 className="mb-3 text-sm font-semibold text-slate-700">New plan</h2>
            <form action={createPlanAction} className="space-y-3">
              <Field label={tr.members.name} required>
                <input name="name" required placeholder="e.g. 3 Month" className={inputCls} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={tr.membership.duration} required>
                  <input
                    name="durationValue"
                    type="number"
                    min={1}
                    defaultValue={3}
                    required
                    className={inputCls}
                  />
                </Field>
                <Field label="Unit">
                  <select name="durationUnit" className={inputCls} defaultValue="months">
                    <option value="months">Months</option>
                    <option value="days">Days</option>
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={`${tr.membership.price} (₹)`} required>
                  <input
                    name="basePrice"
                    inputMode="decimal"
                    required
                    placeholder="2500"
                    className={inputCls}
                  />
                </Field>
                <Field label={`${tr.membership.joiningFee} (₹)`}>
                  <input
                    name="joiningFee"
                    inputMode="decimal"
                    placeholder="500"
                    className={inputCls}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Grace days">
                  <input
                    name="gracePeriodDays"
                    type="number"
                    min={0}
                    max={60}
                    defaultValue={3}
                    className={inputCls}
                  />
                </Field>
                <Field label="Freeze days">
                  <input
                    name="freezeAllowanceDays"
                    type="number"
                    min={0}
                    max={365}
                    defaultValue={30}
                    className={inputCls}
                  />
                </Field>
                <Field label="Max freezes">
                  <input
                    name="maxFreezes"
                    type="number"
                    min={0}
                    max={12}
                    defaultValue={2}
                    className={inputCls}
                  />
                </Field>
              </div>
              <Field label="Allowed timings" hint="Optional, e.g. 05:30-10:30 for a morning plan">
                <input name="allowedTimings" className={inputCls} />
              </Field>
              <Field label="Public description">
                <input name="publicDescription" className={inputCls} />
              </Field>
              <Button className="w-full">{tr.common.save}</Button>
            </form>
          </Card>
        ) : null}
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-base font-semibold text-slate-900">PT & add-on packages</h2>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Table
              headers={[
                'Package',
                'Type',
                'Sessions',
                'Validity',
                tr.membership.price,
                tr.members.status,
              ]}
            >
              {addonPackages.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-3 font-medium">{a.name}</td>
                  <td className="px-4 py-3 text-slate-500">{a.kind.replace('_', ' ')}</td>
                  <td className="px-4 py-3">{a.session_count ?? '∞'}</td>
                  <td className="px-4 py-3">{a.validity_days} days</td>
                  <td className="px-4 py-3">{formatMoney(Number(a.price))}</td>
                  <td className="px-4 py-3">
                    <Badge tone={a.is_active ? 'success' : 'muted'}>
                      {a.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </Table>
          </div>
          {canManage ? (
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-slate-700">New package</h3>
              <form action={createAddonAction} className="space-y-3">
                <Field label={tr.members.name} required>
                  <input name="name" required placeholder="PT 10 Sessions" className={inputCls} />
                </Field>
                <Field label="Type" required>
                  <select name="kind" className={inputCls} defaultValue="personal_training">
                    <option value="personal_training">Personal training</option>
                    <option value="group_class">Group class</option>
                    <option value="locker">Locker</option>
                    <option value="towel">Towel</option>
                    <option value="nutrition">Nutrition</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Sessions" hint="Empty = unlimited">
                    <input
                      name="sessionCount"
                      type="number"
                      min={1}
                      max={500}
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Validity days" required>
                    <input
                      name="validityDays"
                      type="number"
                      min={1}
                      max={730}
                      defaultValue={45}
                      required
                      className={inputCls}
                    />
                  </Field>
                  <Field label={`${tr.membership.price} (₹)`} required>
                    <input name="price" inputMode="decimal" required className={inputCls} />
                  </Field>
                </div>
                <Button className="w-full">{tr.common.save}</Button>
              </form>
            </Card>
          ) : null}
        </div>
      </section>
    </>
  );
}
