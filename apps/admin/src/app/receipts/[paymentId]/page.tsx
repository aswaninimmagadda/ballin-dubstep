import { notFound } from 'next/navigation';
import { formatDisplayDate, formatMoney } from '@gymflow/utils';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { hasPermission } from '@gymflow/core';
import { parseMoney } from '@gymflow/utils';
import { requirePermission } from '@/lib/session';
import { getReceipt, refundPayment } from '@/lib/services/payments';
import { toUserMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui';

export const dynamic = 'force-dynamic';

async function refundAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('payments.refund');
  const paymentId = String(formData.get('paymentId'));
  try {
    await refundPayment(user, {
      paymentId,
      amount: parseMoney(String(formData.get('amount') ?? '')),
      reason: String(formData.get('reason') ?? '').trim(),
      idempotencyKey: String(formData.get('idempotencyKey') ?? '') || undefined,
    });
  } catch (err) {
    redirect(`/receipts/${paymentId}?error=${encodeURIComponent(toUserMessage(err))}`);
  }
  redirect(`/receipts/${paymentId}?msg=refunded`);
}

export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ paymentId: string }>;
  searchParams: Promise<{ error?: string; msg?: string }>;
}) {
  const user = await requirePermission('payments.view');
  const { paymentId } = await params;
  const { error, msg } = await searchParams;
  const [receipt, tr] = await Promise.all([getReceipt(user, paymentId), t()]);
  if (!receipt) notFound();
  const canRefund =
    hasPermission(user.permissions, 'payments.refund') || user.kind === 'platform_admin';

  return (
    <main className="mx-auto max-w-md p-6">
      <div className="no-print mb-4 flex items-center justify-between">
        <Button href="/payments" variant="secondary" type="button">
          ← {tr.common.back}
        </Button>
        <span className="text-xs text-slate-400">Print: Ctrl/Cmd+P</span>
      </div>
      <div className="rounded-xl border border-slate-300 bg-white p-6">
        <header className="border-b border-dashed border-slate-300 pb-4 text-center">
          <h1 className="text-xl font-bold">{receipt.gym_name}</h1>
          <p className="text-sm text-slate-500">{receipt.branch_name}</p>
        </header>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">{tr.payments.receiptNumber}</dt>
            <dd className="font-mono font-semibold">{receipt.receipt_number}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">{tr.payments.date}</dt>
            <dd>{formatDisplayDate(receipt.payment_date)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">{tr.members.name}</dt>
            <dd>{receipt.member_name}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">{tr.members.memberNumber}</dt>
            <dd>{receipt.membership_number}</dd>
          </div>
          {receipt.plan_name ? (
            <div className="flex justify-between">
              <dt className="text-slate-500">{tr.members.plan}</dt>
              <dd>{receipt.plan_name}</dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt className="text-slate-500">{tr.payments.method}</dt>
            <dd>
              {tr.payments.methods[receipt.method as keyof typeof tr.payments.methods] ??
                receipt.method}
            </dd>
          </div>
          {receipt.external_reference ? (
            <div className="flex justify-between">
              <dt className="text-slate-500">{tr.payments.reference}</dt>
              <dd className="font-mono">{receipt.external_reference}</dd>
            </div>
          ) : null}
          {receipt.received_by_name ? (
            <div className="flex justify-between">
              <dt className="text-slate-500">{tr.payments.receivedBy}</dt>
              <dd>{receipt.received_by_name}</dd>
            </div>
          ) : null}
        </dl>
        <div className="mt-4 border-t border-dashed border-slate-300 pt-4">
          <div className="flex items-center justify-between">
            <span className="text-base font-semibold">{tr.membership.total}</span>
            <span className="text-2xl font-bold">{formatMoney(Number(receipt.amount))}</span>
          </div>
        </div>
        {receipt.receipt_footer ? (
          <p className="mt-4 text-center text-xs text-slate-500">{receipt.receipt_footer}</p>
        ) : null}
        <p className="mt-2 text-center text-[10px] text-slate-400">
          Receipt generated digitally — no signature required.
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          className="no-print mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}
      {msg === 'refunded' ? (
        <p
          role="status"
          className="no-print mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700"
        >
          Refund recorded. The original payment stays on record.
        </p>
      ) : null}

      {canRefund ? (
        <details className="no-print mt-6 rounded-xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">
            {tr.payments.refund}…
          </summary>
          <form action={refundAction} className="mt-3 space-y-3">
            <input type="hidden" name="paymentId" value={paymentId} />
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <label className="block text-sm font-medium text-slate-700">
              {tr.payments.amount} (₹)
              <input
                name="amount"
                inputMode="decimal"
                required
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              {tr.payments.refundReason}
              <input
                name="reason"
                required
                minLength={3}
                maxLength={500}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <Button variant="danger">{tr.payments.refund}</Button>
          </form>
        </details>
      ) : null}
    </main>
  );
}
