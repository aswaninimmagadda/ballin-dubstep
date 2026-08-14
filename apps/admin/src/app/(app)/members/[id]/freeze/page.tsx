import { notFound, redirect } from 'next/navigation';
import { todayInTz, addDays } from '@gymflow/utils';
import { freezeMembershipSchema } from '@gymflow/validation';
import { requirePermission } from '@/lib/session';
import { getMemberDetail } from '@/lib/services/members';
import { freezeMembership } from '@/lib/services/memberships';
import { toUserMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { Button, Card, ErrorBanner, Field, PageHeader, inputCls } from '@/components/ui';

export const dynamic = 'force-dynamic';

async function freezeAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('memberships.freeze');
  const memberId = String(formData.get('memberId'));
  const parsed = freezeMembershipSchema.safeParse({
    membershipId: String(formData.get('membershipId')),
    startDate: String(formData.get('startDate')),
    plannedEndDate: String(formData.get('plannedEndDate') ?? '') || null,
    reason: String(formData.get('reason') ?? ''),
    note: String(formData.get('note') ?? '') || null,
    extendsExpiry: formData.get('extendsExpiry') === 'on',
  });
  if (!parsed.success) {
    redirect(`/members/${memberId}/freeze?error=${encodeURIComponent('Please fill the freeze details.')}`);
  }
  try {
    await freezeMembership(user, parsed.data);
  } catch (err) {
    redirect(`/members/${memberId}/freeze?error=${encodeURIComponent(toUserMessage(err))}`);
  }
  redirect(`/members/${memberId}?msg=frozen`);
}

export default async function FreezePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requirePermission('memberships.freeze');
  const { id } = await params;
  const { error } = await searchParams;
  const [detail, tr] = await Promise.all([getMemberDetail(user, id), t()]);
  if (!detail?.currentMembership) notFound();
  const today = todayInTz();

  return (
    <>
      <PageHeader
        title={`${tr.membership.freezeTitle} — ${detail.member.first_name}`}
        subtitle={`${String(detail.currentMembership.plan_name_snapshot)} · ${tr.membership.currentExpiry} ${String(detail.currentMembership.end_date)}`}
      />
      <ErrorBanner message={error ?? null} />
      <Card className="max-w-lg">
        <form action={freezeAction} className="space-y-4">
          <input type="hidden" name="memberId" value={id} />
          <input type="hidden" name="membershipId" value={String(detail.currentMembership.id)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tr.membership.freezeStart} required>
              <input name="startDate" type="date" defaultValue={today} required className={inputCls} />
            </Field>
            <Field label={tr.membership.freezeReturn}>
              <input name="plannedEndDate" type="date" defaultValue={addDays(today, 15)} className={inputCls} />
            </Field>
          </div>
          <Field label={tr.membership.freezeReason} required>
            <input name="reason" required minLength={2} placeholder="Medical / travel / personal" className={inputCls} />
          </Field>
          <Field label={tr.members.notes}>
            <textarea name="note" rows={2} className={inputCls} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="extendsExpiry" defaultChecked className="h-4 w-4" />
            {tr.membership.freezeExtends}
          </label>
          <div className="flex gap-2">
            <Button>{tr.common.confirm}</Button>
            <Button href={`/members/${id}`} variant="secondary" type="button">{tr.common.cancel}</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
