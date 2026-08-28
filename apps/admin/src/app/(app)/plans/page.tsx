import { redirect } from 'next/navigation';
import { formatMoney, parseMoney } from '@gymflow/utils';
import { createPlanSchema } from '@gymflow/validation';
import { requirePermission } from '@/lib/session';
import { hasPermission } from '@gymflow/core';
import { createPlan, listPlans, setPlanActive, updatePlanTerms } from '@/lib/services/plans';
import { createAddonPackage, listAddonPackages, updateAddonPackage } from '@/lib/services/addons';
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
      taxRateBps: Number(formData.get('taxRateBps') ?? 0),
      taxInclusive: String(formData.get('taxInclusive') ?? 'true') === 'true',
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

/**
 * Change a plan's price. The page has always promised "Price changes create a
 * new version — past sales keep their original terms", and updatePlanTerms
 * has always done exactly that; there was simply no way to reach it, so an
 * owner whose rates went up had to create a second plan with a different name
 * (a duplicate name failed with "Something went wrong") and the old one stayed
 * sellable.
 *
 * Every other term is carried forward from the current version, so this is a
 * reprice and not a silent reset of duration, freezes or grace.
 */
async function repriceAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('plans.manage');
  const planId = String(formData.get('planId'));
  let basePrice = 0;
  let joiningFee = 0;
  try {
    basePrice = parseMoney(String(formData.get('basePrice') ?? ''));
    joiningFee = parseMoney(String(formData.get('joiningFee') ?? '0'));
  } catch {
    redirect(`/plans?error=${encodeURIComponent('Enter a valid price, e.g. 2500')}`);
  }
  const plans = await listPlans(user, true);
  const current = plans.find((p) => p.id === planId);
  if (!current) redirect(`/plans?error=${encodeURIComponent('Plan not found.')}`);
  try {
    await updatePlanTerms(user, planId, {
      durationUnit: current.duration_unit,
      durationValue: current.duration_value,
      basePrice,
      joiningFee,
      taxRateBps: Number(formData.get('taxRateBps') ?? current.tax_rate_bps),
      taxInclusive: current.tax_inclusive,
      freezeAllowanceDays: current.freeze_allowance_days,
      maxFreezes: current.max_freezes,
      gracePeriodDays: current.grace_period_days,
      allowedTimings: current.allowed_timings,
    });
  } catch (err) {
    redirect(`/plans?error=${encodeURIComponent(toUserMessage(err))}`);
  }
  redirect('/plans?msg=repriced');
}

async function repriceAddonAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('plans.manage');
  let price = 0;
  try {
    price = parseMoney(String(formData.get('price') ?? ''));
  } catch {
    redirect(`/plans?error=${encodeURIComponent('Enter a valid package price, e.g. 2000')}`);
  }
  try {
    await updateAddonPackage(user, String(formData.get('packageId')), { price });
  } catch (err) {
    redirect(`/plans?error=${encodeURIComponent(toUserMessage(err))}`);
  }
  redirect('/plans?msg=repriced');
}

async function toggleAddonActiveAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('plans.manage');
  try {
    await updateAddonPackage(user, String(formData.get('packageId')), {
      isActive: formData.get('active') === '1',
    });
  } catch (err) {
    redirect(`/plans?error=${encodeURIComponent(toUserMessage(err))}`);
  }
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
                    <div className="flex flex-col items-end gap-2">
                      <form action={repriceAction} className="flex items-center gap-1">
                        <input type="hidden" name="planId" value={p.id} />
                        <input
                          name="basePrice"
                          required
                          inputMode="decimal"
                          defaultValue={String(Number(p.base_price) / 100)}
                          aria-label={`New price for ${p.name}`}
                          className="w-20 rounded-md border border-slate-300 px-2 py-1 text-xs"
                        />
                        <input
                          name="joiningFee"
                          inputMode="decimal"
                          defaultValue={String(Number(p.joining_fee) / 100)}
                          aria-label={`New joining fee for ${p.name}`}
                          className="w-16 rounded-md border border-slate-300 px-2 py-1 text-xs"
                        />
                        <button className="whitespace-nowrap text-xs font-semibold text-primary hover:underline">
                          {tr.plans.reprice}
                        </button>
                      </form>
                      <form action={toggleActiveAction}>
                        <input type="hidden" name="planId" value={p.id} />
                        <input type="hidden" name="active" value={p.is_active ? '0' : '1'} />
                        <button className="text-xs font-semibold text-slate-500 hover:text-slate-700">
                          {p.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </form>
                    </div>
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
              {/* Fitness services are SAC 999723, taxed at 18%. Gyms below the
                  GST turnover threshold leave this at 0% and get the plain
                  receipt; the rate is frozen onto each sale, so changing it
                  here never alters an invoice already issued. */}
              <div className="grid grid-cols-2 gap-3">
                <Field label={tr.plans.gstRate} hint={tr.plans.gstHint}>
                  <select name="taxRateBps" defaultValue="0" className={inputCls}>
                    <option value="0">{tr.plans.gstNotRegistered}</option>
                    <option value="500">5%</option>
                    <option value="1200">12%</option>
                    <option value="1800">18%</option>
                    <option value="2800">28%</option>
                  </select>
                </Field>
                <Field label={tr.plans.gstMode}>
                  <select name="taxInclusive" defaultValue="true" className={inputCls}>
                    <option value="true">{tr.plans.gstInclusive}</option>
                    <option value="false">{tr.plans.gstExclusive}</option>
                  </select>
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
                '',
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
                  <td className="px-4 py-3">
                    {canManage ? (
                      <div className="flex flex-col items-end gap-2">
                        <form action={repriceAddonAction} className="flex items-center gap-1">
                          <input type="hidden" name="packageId" value={a.id} />
                          <input
                            name="price"
                            required
                            inputMode="decimal"
                            defaultValue={String(Number(a.price) / 100)}
                            aria-label={`New price for ${a.name}`}
                            className="w-20 rounded-md border border-slate-300 px-2 py-1 text-xs"
                          />
                          <button className="whitespace-nowrap text-xs font-semibold text-primary hover:underline">
                            {tr.plans.reprice}
                          </button>
                        </form>
                        <form action={toggleAddonActiveAction}>
                          <input type="hidden" name="packageId" value={a.id} />
                          <input type="hidden" name="active" value={a.is_active ? '0' : '1'} />
                          <button className="text-xs font-semibold text-slate-500 hover:text-slate-700">
                            {a.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                        </form>
                      </div>
                    ) : null}
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
                {/* PT is the same taxable supply as a membership (SAC 999723).
                    A registered gym leaving this at 0% would issue a
                    non-compliant receipt for every package it sells. */}
                <div className="grid grid-cols-2 gap-3">
                  <Field label={tr.plans.gstRate}>
                    <select name="addonTaxRateBps" defaultValue="0" className={inputCls}>
                      <option value="0">{tr.plans.gstNotRegistered}</option>
                      <option value="500">5%</option>
                      <option value="1200">12%</option>
                      <option value="1800">18%</option>
                      <option value="2800">28%</option>
                    </select>
                  </Field>
                  <Field label={tr.plans.gstMode}>
                    <select name="addonTaxInclusive" defaultValue="true" className={inputCls}>
                      <option value="true">{tr.plans.gstInclusive}</option>
                      <option value="false">{tr.plans.gstExclusive}</option>
                    </select>
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
