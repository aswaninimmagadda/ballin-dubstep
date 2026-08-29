import { notFound, redirect } from 'next/navigation';
import { formatMoney } from '@gymflow/utils';
import { requirePermission } from '@/lib/session';
import { getMemberDetail } from '@/lib/services/members';
import { correctMembership } from '@/lib/services/memberships';
import { listPlans } from '@/lib/services/plans';
import { toUserMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { Button, Card, ErrorBanner, Field, PageHeader, inputCls } from '@/components/ui';

export const dynamic = 'force-dynamic';

/**
 * Fix a membership sold on the wrong plan or the wrong start date.
 *
 * The alternative staff had was to cancel and re-sell, which leaves the
 * payment allocated to the cancelled row — the member then reads as owing the
 * full amount again while the money sits somewhere nothing counts. Correcting
 * keeps the same membership, so the receipt and the allocations stay pointed
 * at it.
 */
async function correctAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('memberships.override');
  const memberId = String(formData.get('memberId'));
  try {
    await correctMembership(user, {
      membershipId: String(formData.get('membershipId')),
      planId: String(formData.get('planId') ?? '') || undefined,
      startDate: String(formData.get('startDate') ?? '') || undefined,
      reason: String(formData.get('reason') ?? ''),
    });
  } catch (err) {
    redirect(`/members/${memberId}/correct?error=${encodeURIComponent(toUserMessage(err))}`);
  }
  redirect(`/members/${memberId}?msg=corrected`);
}

export default async function CorrectMembershipPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requirePermission('memberships.override');
  const { id } = await params;
  const { error } = await searchParams;
  const [detail, plans, tr] = await Promise.all([getMemberDetail(user, id), listPlans(user), t()]);
  if (!detail) notFound();

  const live = detail.memberships.find((m) =>
    ['pending', 'active', 'frozen'].includes(String(m.state)),
  );
  if (!live) {
    return (
      <>
        <PageHeader title={tr.membership.correct} />
        <Card className="max-w-xl">
          <p className="text-sm text-slate-600">{tr.membership.correctNoLive}</p>
          <div className="mt-4">
            <Button href={`/members/${id}`} variant="secondary" type="button">
              {tr.common.back}
            </Button>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`${tr.membership.correct} — ${detail.member.first_name} ${detail.member.last_name ?? ''}`}
        subtitle={tr.membership.correctSubtitle}
      />
      <ErrorBanner message={error ?? null} />
      <Card className="max-w-xl">
        <dl className="mb-4 space-y-1 border-b border-slate-100 pb-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">{tr.members.plan}</dt>
            <dd className="font-medium">{String(live.plan_name_snapshot)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">{tr.membership.startDate}</dt>
            <dd>{String(live.start_date)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">{tr.members.expiry}</dt>
            <dd>{String(live.end_date)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">{tr.membership.total}</dt>
            <dd>{formatMoney(Number(live.total_amount))}</dd>
          </div>
        </dl>
        <form action={correctAction} className="space-y-4">
          <input type="hidden" name="memberId" value={id} />
          <input type="hidden" name="membershipId" value={String(live.id)} />
          <Field label={tr.members.plan} hint={tr.membership.correctPlanHint}>
            <select name="planId" defaultValue={String(live.plan_id)} className={inputCls}>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {formatMoney(Number(p.base_price))}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tr.membership.startDate} hint={tr.membership.correctDateHint}>
            <input
              name="startDate"
              type="date"
              defaultValue={String(live.start_date)}
              className={inputCls}
            />
          </Field>
          <Field label={tr.ui.reason} required>
            <input
              name="reason"
              required
              minLength={3}
              placeholder={tr.membership.correctReasonHint}
              className={inputCls}
            />
          </Field>
          <div className="flex gap-2">
            <Button>{tr.common.save}</Button>
            <Button href={`/members/${id}`} variant="secondary" type="button">
              {tr.common.cancel}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
