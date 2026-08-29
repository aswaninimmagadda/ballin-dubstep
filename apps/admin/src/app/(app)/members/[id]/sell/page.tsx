import { hasPermission } from '@gymflow/core';
import { notFound, redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { formatMoney, todayInTz, parseMoney } from '@gymflow/utils';
import { AMOUNT_ERROR, readAmount } from '@/lib/amount';
import { sellMembershipSchema } from '@gymflow/validation';
import { requirePermission } from '@/lib/session';
import { getMemberDetail } from '@/lib/services/members';
import { sellMembership } from '@/lib/services/memberships';
import { listPlans } from '@/lib/services/plans';
import { getSettings } from '@/lib/services/settings';
import { toUserMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { Button, Card, ErrorBanner, Field, PageHeader, inputCls } from '@/components/ui';

export const dynamic = 'force-dynamic';

/**
 * An empty discount field means "no discount", not "zero" — the schema treats
 * an explicit 0 the same way, but keeping undefined out of the payload makes
 * the intent obvious in the audit trail.
 */
function discountPaise(raw: FormDataEntryValue | null): number | undefined {
  const text = String(raw ?? '').trim();
  if (!text) return undefined;
  try {
    const paise = parseMoney(text);
    return paise > 0 ? paise : undefined;
  } catch {
    return undefined;
  }
}

async function sellAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('memberships.sell');
  const memberId = String(formData.get('memberId'));
  const amount = readAmount(formData.get('amount'));
  if (amount.kind === 'invalid') {
    redirect(`/members/${memberId}/sell?error=${encodeURIComponent(AMOUNT_ERROR)}`);
  }
  const payload = {
    memberId,
    planId: String(formData.get('planId') ?? ''),
    startDate: String(formData.get('startDate') ?? ''),
    includeJoiningFee: formData.get('includeJoiningFee') === 'on',
    promotionCode: String(formData.get('promotionCode') ?? '').trim() || null,
    // Sent only when the field is filled in; the service refuses a discount
    // over the gym's threshold unless the actor holds discounts.approve.
    manualDiscount: discountPaise(formData.get('manualDiscount')),
    idempotencyKey: String(formData.get('idempotencyKey') ?? ''),
    payment:
      amount.kind === 'ok'
        ? {
            amount: amount.paise,
            method: String(formData.get('method') ?? 'cash') as 'cash',
            externalReference: String(formData.get('externalReference') ?? '').trim() || null,
          }
        : undefined,
  };
  const parsed = sellMembershipSchema.safeParse(payload);
  if (!parsed.success) {
    redirect(
      `/members/${memberId}/sell?error=${encodeURIComponent('Please check the form and try again.')}`,
    );
  }
  let receipt: string | null = null;
  try {
    const result = await sellMembership(user, parsed.data);
    receipt = result.receiptNumber;
  } catch (err) {
    redirect(`/members/${memberId}/sell?error=${encodeURIComponent(toUserMessage(err))}`);
  }
  redirect(receipt ? `/members/${memberId}?msg=sold` : `/members/${memberId}?msg=sold`);
}

export default async function SellPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; new?: string }>;
}) {
  const user = await requirePermission('memberships.sell');
  // The gym's approval threshold is checked server-side; anyone who may
  // apply a discount at all sees the field.
  const canDiscount =
    user.kind === 'platform_admin' ||
    hasPermission(user.permissions, 'discounts.apply') ||
    hasPermission(user.permissions, 'discounts.approve');
  const { id } = await params;
  const { error, new: isNew } = await searchParams;
  const [detail, plans, tr, settings] = await Promise.all([
    getMemberDetail(user, id),
    listPlans(user),
    t(),
    getSettings(user),
  ]);
  // The hint used to invite the exact action the service refuses when a
  // gym has not switched part payments on, which is every gym on day one.
  const partPaymentsOn = settings?.allow_partial_payments ?? false;
  if (!detail) notFound();
  const today = todayInTz();

  return (
    <>
      <PageHeader
        title={`${tr.membership.sell} — ${detail.member.first_name} ${detail.member.last_name ?? ''}`}
        subtitle={isNew ? 'Member created. Now choose a plan.' : undefined}
      />
      <ErrorBanner message={error ?? null} />
      <Card className="max-w-2xl">
        <form action={sellAction} className="space-y-4">
          <input type="hidden" name="memberId" value={id} />
          <input type="hidden" name="idempotencyKey" value={randomUUID()} />

          <Field label={tr.members.plan} required>
            <div className="space-y-2">
              {plans.map((p, i) => (
                <label
                  key={p.id}
                  className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 px-4 py-3 hover:border-primary has-checked:border-primary has-checked:bg-green-50"
                >
                  <span className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="planId"
                      value={p.id}
                      required
                      defaultChecked={i === 0}
                      className="h-4 w-4"
                    />
                    <span>
                      <span className="block text-sm font-semibold">{p.name}</span>
                      <span className="block text-xs text-slate-500">
                        {p.duration_value} {p.duration_unit === 'months' ? 'months' : 'days'}
                        {Number(p.joining_fee) > 0
                          ? ` · ${tr.membership.joiningFee} ${formatMoney(Number(p.joining_fee))}`
                          : ''}
                      </span>
                    </span>
                  </span>
                  <span className="text-sm font-bold">{formatMoney(Number(p.base_price))}</span>
                </label>
              ))}
            </div>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tr.membership.startDate} required>
              <input
                name="startDate"
                type="date"
                defaultValue={today}
                required
                className={inputCls}
              />
            </Field>
            <Field label={tr.membership.promotion} hint={tr.ui.optionalPromoCode}>
              <input name="promotionCode" placeholder="e.g. NEWYEAR26" className={inputCls} />
            </Field>
            {/* A promo code and a hand-written discount are mutually exclusive;
                the service takes the promotion when both are sent. The
                approval threshold in Settings is enforced server-side, so this
                field is safe to show to anyone who may sell. */}
            {canDiscount ? (
              <Field label={tr.membership.manualDiscount} hint={tr.membership.manualDiscountHint}>
                <input
                  name="manualDiscount"
                  inputMode="decimal"
                  placeholder="0"
                  className={inputCls}
                />
              </Field>
            ) : null}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="includeJoiningFee" defaultChecked className="h-4 w-4" />
            {tr.membership.joiningFee}
          </label>

          <fieldset className="rounded-lg border border-slate-200 p-4">
            <legend className="px-1 text-sm font-semibold text-slate-700">
              {tr.members.recordPayment}
            </legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label={`${tr.payments.amount} (₹)`}
                hint={partPaymentsOn ? tr.membership.payLaterHint : tr.membership.payFullHint}
              >
                <input name="amount" inputMode="decimal" placeholder="2500" className={inputCls} />
              </Field>
              <Field label={tr.payments.method}>
                <select name="method" className={inputCls} defaultValue="cash">
                  {Object.entries(tr.payments.methods).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={tr.payments.reference}>
                <input
                  name="externalReference"
                  placeholder={tr.ui.upiRefUtr}
                  className={inputCls}
                />
              </Field>
            </div>
          </fieldset>

          <div className="flex gap-2">
            <Button>{tr.common.confirm}</Button>
            <Button href={`/members/${id}`} variant="secondary" type="button">
              {tr.common.cancel}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
