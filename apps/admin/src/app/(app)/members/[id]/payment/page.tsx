import { notFound, redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { parseMoney, todayInTz } from '@gymflow/utils';
import { recordPaymentSchema } from '@gymflow/validation';
import { requirePermission } from '@/lib/session';
import { getMemberDetail } from '@/lib/services/members';
import {
  recordPayment,
  earliestPaymentDate as earliestPaymentDateFor,
} from '@/lib/services/payments';
import { toUserMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { Button, Card, ErrorBanner, Field, PageHeader, inputCls } from '@/components/ui';

export const dynamic = 'force-dynamic';

async function paymentAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('payments.record');
  const memberId = String(formData.get('memberId'));
  let payload;
  try {
    payload = {
      memberId,
      membershipId: String(formData.get('membershipId') ?? '') || null,
      amount: parseMoney(String(formData.get('amount') ?? '')),
      method: String(formData.get('method') ?? 'cash'),
      externalReference: String(formData.get('externalReference') ?? '').trim() || null,
      paymentDate: String(formData.get('paymentDate') ?? '') || undefined,
      notes: String(formData.get('notes') ?? '').trim() || null,
      idempotencyKey: String(formData.get('idempotencyKey') ?? ''),
    };
  } catch {
    redirect(
      `/members/${memberId}/payment?error=${encodeURIComponent('Enter a valid amount, e.g. 2500')}`,
    );
  }
  const parsed = recordPaymentSchema.safeParse(payload);
  if (!parsed.success) {
    redirect(`/members/${memberId}/payment?error=${encodeURIComponent('Please check the form.')}`);
  }
  let paymentId: string;
  try {
    const result = await recordPayment(user, parsed.data);
    paymentId = result.paymentId;
  } catch (err) {
    redirect(`/members/${memberId}/payment?error=${encodeURIComponent(toUserMessage(err))}`);
  }
  redirect(`/receipts/${paymentId!}`);
}

export default async function PaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requirePermission('payments.record');
  const { id } = await params;
  const { error } = await searchParams;
  const [detail, tr] = await Promise.all([getMemberDetail(user, id), t()]);
  if (!detail) notFound();
  const today = todayInTz();
  const earliestPaymentDate = earliestPaymentDateFor(today);

  return (
    <>
      <PageHeader
        title={`${tr.members.recordPayment} — ${detail.member.first_name} ${detail.member.last_name ?? ''}`}
      />
      <ErrorBanner message={error ?? null} />
      <Card className="max-w-lg">
        <form action={paymentAction} className="space-y-4">
          <input type="hidden" name="memberId" value={id} />
          <input type="hidden" name="idempotencyKey" value={randomUUID()} />
          {detail.currentMembership ? (
            <input type="hidden" name="membershipId" value={String(detail.currentMembership.id)} />
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`${tr.payments.amount} (₹)`} required>
              <input
                name="amount"
                inputMode="decimal"
                required
                placeholder="2500"
                autoFocus
                className={inputCls}
              />
            </Field>
            <Field label={tr.payments.method} required>
              <select name="method" className={inputCls} defaultValue="cash">
                {Object.entries(tr.payments.methods).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={tr.payments.reference} hint={tr.ui.upiUtrReferenceForNon}>
              <input name="externalReference" className={inputCls} />
            </Field>
            {/* Bounded in the browser as well as the server: the receipt's
                financial-year number is derived from this date and receipts
                are append-only, so a slipped year cannot be undone. */}
            <Field label={tr.payments.date}>
              <input
                name="paymentDate"
                type="date"
                defaultValue={today}
                min={earliestPaymentDate}
                max={today}
                className={inputCls}
              />
            </Field>
          </div>
          <Field label={tr.members.notes}>
            <input name="notes" className={inputCls} />
          </Field>
          <div className="flex gap-2">
            <Button>
              {tr.common.confirm} → {tr.payments.receipt}
            </Button>
            <Button href={`/members/${id}`} variant="secondary" type="button">
              {tr.common.cancel}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
