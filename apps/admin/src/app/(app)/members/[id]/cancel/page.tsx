import { notFound, redirect } from 'next/navigation';
import { requirePermission } from '@/lib/session';
import { getMemberDetail } from '@/lib/services/members';
import { cancelMembership } from '@/lib/services/memberships';
import { toUserMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { Button, Card, ErrorBanner, Field, PageHeader, inputCls } from '@/components/ui';

export const dynamic = 'force-dynamic';

async function cancelAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('memberships.cancel');
  const memberId = String(formData.get('memberId'));
  const reason = String(formData.get('reason') ?? '').trim();
  if (reason.length < 3) {
    redirect(`/members/${memberId}/cancel?error=${encodeURIComponent('A reason is required.')}`);
  }
  try {
    await cancelMembership(user, {
      membershipId: String(formData.get('membershipId')),
      reason,
    });
  } catch (err) {
    redirect(`/members/${memberId}/cancel?error=${encodeURIComponent(toUserMessage(err))}`);
  }
  redirect(`/members/${memberId}?msg=cancelled`);
}

export default async function CancelPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requirePermission('memberships.cancel');
  const { id } = await params;
  const { error } = await searchParams;
  const [detail, tr] = await Promise.all([getMemberDetail(user, id), t()]);
  if (!detail?.currentMembership) notFound();

  return (
    <>
      <PageHeader
        title={`Cancel membership — ${detail.member.first_name}`}
        subtitle={`${String(detail.currentMembership.plan_name_snapshot)} · ends ${String(detail.currentMembership.end_date)}`}
      />
      <ErrorBanner message={error ?? null} />
      <Card className="max-w-lg border-red-200">
        <p className="mb-4 text-sm text-slate-600">
          Cancelling keeps every record (membership, payments, receipts) — nothing is deleted.
          Refunds, if any, are recorded separately by the accountant.
        </p>
        <form action={cancelAction} className="space-y-4">
          <input type="hidden" name="memberId" value={id} />
          <input type="hidden" name="membershipId" value={String(detail.currentMembership.id)} />
          <Field label="Reason" required>
            <input
              name="reason"
              required
              minLength={3}
              maxLength={500}
              className={inputCls}
              placeholder="Moving away / medical / dissatisfied…"
            />
          </Field>
          <div className="flex gap-2">
            <Button variant="danger">Cancel membership</Button>
            <Button href={`/members/${id}`} variant="secondary" type="button">
              {tr.common.back}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
