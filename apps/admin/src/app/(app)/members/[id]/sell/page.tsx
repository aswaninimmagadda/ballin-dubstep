import { notFound, redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { formatMoney, parseMoney, todayInTz } from '@gymflow/utils';
import { sellMembershipSchema } from '@gymflow/validation';
import { requirePermission } from '@/lib/session';
import { getMemberDetail } from '@/lib/services/members';
import { sellMembership } from '@/lib/services/memberships';
import { listPlans } from '@/lib/services/plans';
import { toUserMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { Button, Card, ErrorBanner, Field, PageHeader, inputCls } from '@/components/ui';

export const dynamic = 'force-dynamic';

async function sellAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('memberships.sell');
  const memberId = String(formData.get('memberId'));
  const amountRaw = String(formData.get('amount') ?? '').trim();
  const payload = {
    memberId,
    planId: String(formData.get('planId') ?? ''),
    startDate: String(formData.get('startDate') ?? ''),
    includeJoiningFee: formData.get('includeJoiningFee') === 'on',
    promotionCode: String(formData.get('promotionCode') ?? '').trim() || null,
    idempotencyKey: String(formData.get('idempotencyKey') ?? ''),
    payment: amountRaw
      ? {
          amount: parseMoney(amountRaw),
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
  const { id } = await params;
  const { error, new: isNew } = await searchParams;
  const [detail, plans, tr] = await Promise.all([getMemberDetail(user, id), listPlans(user), t()]);
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
            <Field label={tr.membership.promotion} hint="Optional promo code">
              <input name="promotionCode" placeholder="e.g. NEWYEAR26" className={inputCls} />
            </Field>
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
              <Field label={`${tr.payments.amount} (₹)`} hint="Leave empty to record payment later">
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
                <input name="externalReference" placeholder="UPI ref / UTR" className={inputCls} />
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
