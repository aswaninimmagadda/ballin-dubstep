import { notFound, redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { proposeRenewal } from '@gymflow/core';
import { formatDisplayDate, formatMoney, parseMoney, todayInTz } from '@gymflow/utils';
import { renewMembershipSchema } from '@gymflow/validation';
import { requirePermission } from '@/lib/session';
import { getMemberDetail } from '@/lib/services/members';
import { renewMembership } from '@/lib/services/memberships';
import { listPlans } from '@/lib/services/plans';
import { toUserMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { Button, Card, ErrorBanner, Field, PageHeader, inputCls } from '@/components/ui';

export const dynamic = 'force-dynamic';

async function renewAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('memberships.renew');
  const memberId = String(formData.get('memberId'));
  const amountRaw = String(formData.get('amount') ?? '').trim();
  const payload = {
    memberId,
    previousMembershipId: String(formData.get('previousMembershipId') ?? ''),
    planId: String(formData.get('planId') ?? ''),
    includeJoiningFee: false,
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
  const parsed = renewMembershipSchema.safeParse(payload);
  if (!parsed.success) {
    redirect(
      `/members/${memberId}/renew?error=${encodeURIComponent('Please check the form and try again.')}`,
    );
  }
  try {
    await renewMembership(user, parsed.data);
  } catch (err) {
    redirect(`/members/${memberId}/renew?error=${encodeURIComponent(toUserMessage(err))}`);
  }
  redirect(`/members/${memberId}?msg=renewed`);
}

export default async function RenewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requirePermission('memberships.renew');
  const { id } = await params;
  const { error } = await searchParams;
  const [detail, plans, tr] = await Promise.all([getMemberDetail(user, id), listPlans(user), t()]);
  if (!detail) notFound();
  const today = todayInTz();

  // Renew from the current membership, or the most recent one if lapsed.
  const base = detail.currentMembership ?? detail.memberships[0];
  if (!base) redirect(`/members/${id}/sell`);
  const currentEnd = String(base!.end_date);

  return (
    <>
      <PageHeader
        title={`${tr.membership.renew} — ${detail.member.first_name} ${detail.member.last_name ?? ''}`}
        subtitle={`${tr.membership.currentExpiry}: ${formatDisplayDate(currentEnd)}`}
      />
      <ErrorBanner message={error ?? null} />
      <Card className="max-w-2xl">
        <form action={renewAction} className="space-y-4">
          <input type="hidden" name="memberId" value={id} />
          <input type="hidden" name="previousMembershipId" value={String(base!.id)} />
          <input type="hidden" name="idempotencyKey" value={randomUUID()} />

          <Field label={tr.members.plan} required>
            <div className="space-y-2">
              {plans.map((p) => {
                const proposal = proposeRenewal({
                  currentEndDate: currentEnd,
                  today,
                  durationUnit: p.duration_unit,
                  durationValue: p.duration_value,
                });
                const isSame = p.name === String(base!.plan_name_snapshot);
                return (
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
                        defaultChecked={isSame}
                        className="h-4 w-4"
                      />
                      <span>
                        <span className="block text-sm font-semibold">
                          {p.name} {isSame ? '· current plan' : ''}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {tr.membership.newPeriod}: {formatDisplayDate(proposal.startDate)} →{' '}
                          {formatDisplayDate(proposal.endDate)}
                        </span>
                      </span>
                    </span>
                    <span className="text-sm font-bold">{formatMoney(Number(p.base_price))}</span>
                  </label>
                );
              })}
            </div>
          </Field>

          <Field label={tr.membership.promotion} hint="Optional promo code">
            <input
              name="promotionCode"
              placeholder="e.g. WINBACK15"
              className={`${inputCls} max-w-xs`}
            />
          </Field>

          <fieldset className="rounded-lg border border-slate-200 p-4">
            <legend className="px-1 text-sm font-semibold text-slate-700">
              {tr.members.recordPayment}
            </legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={`${tr.payments.amount} (₹)`} hint="Leave empty to collect later">
                <input name="amount" inputMode="decimal" className={inputCls} />
              </Field>
              <Field label={tr.payments.method}>
                <select name="method" className={inputCls} defaultValue="upi">
                  {Object.entries(tr.payments.methods).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={tr.payments.reference}>
                <input name="externalReference" className={inputCls} />
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
