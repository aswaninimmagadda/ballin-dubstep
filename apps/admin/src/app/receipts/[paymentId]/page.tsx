import { notFound } from 'next/navigation';
import { formatDisplayDate, formatMoney } from '@gymflow/utils';
import { requirePermission } from '@/lib/session';
import { getReceipt } from '@/lib/services/payments';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ReceiptPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const user = await requirePermission('payments.view');
  const { paymentId } = await params;
  const [receipt, tr] = await Promise.all([getReceipt(user, paymentId), t()]);
  if (!receipt) notFound();

  return (
    <main className="mx-auto max-w-md p-6">
      <div className="no-print mb-4 flex items-center justify-between">
        <Button href="/payments" variant="secondary" type="button">← {tr.common.back}</Button>
        <span className="text-xs text-slate-400">Print: Ctrl/Cmd+P</span>
      </div>
      <div className="rounded-xl border border-slate-300 bg-white p-6">
        <header className="border-b border-dashed border-slate-300 pb-4 text-center">
          <h1 className="text-xl font-bold">{receipt.gym_name}</h1>
          <p className="text-sm text-slate-500">{receipt.branch_name}</p>
        </header>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-slate-500">{tr.payments.receiptNumber}</dt><dd className="font-mono font-semibold">{receipt.receipt_number}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">{tr.payments.date}</dt><dd>{formatDisplayDate(receipt.payment_date)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">{tr.members.name}</dt><dd>{receipt.member_name}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">{tr.members.memberNumber}</dt><dd>{receipt.membership_number}</dd></div>
          {receipt.plan_name ? (
            <div className="flex justify-between"><dt className="text-slate-500">{tr.members.plan}</dt><dd>{receipt.plan_name}</dd></div>
          ) : null}
          <div className="flex justify-between"><dt className="text-slate-500">{tr.payments.method}</dt>
            <dd>{tr.payments.methods[receipt.method as keyof typeof tr.payments.methods] ?? receipt.method}</dd>
          </div>
          {receipt.external_reference ? (
            <div className="flex justify-between"><dt className="text-slate-500">{tr.payments.reference}</dt><dd className="font-mono">{receipt.external_reference}</dd></div>
          ) : null}
          {receipt.received_by_name ? (
            <div className="flex justify-between"><dt className="text-slate-500">{tr.payments.receivedBy}</dt><dd>{receipt.received_by_name}</dd></div>
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
    </main>
  );
}
