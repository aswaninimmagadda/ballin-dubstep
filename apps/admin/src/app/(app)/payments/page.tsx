import Link from 'next/link';
import { formatDisplayDate, formatMoney } from '@gymflow/utils';
import { requirePermission } from '@/lib/session';
import { asPrincipal } from '@/lib/db';
import { t } from '@/lib/i18n';
import { Badge, Button, PageHeader, Table, EmptyState, inputCls } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const user = await requirePermission('payments.view');
  const { page = '1', q = '' } = await searchParams;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = 50;
  const tr = await t();

  const rows = await asPrincipal(user.claims, async (tx) => {
    const params: unknown[] = [];
    let where = '';
    if (q.trim()) {
      params.push(`%${q.trim()}%`);
      // §31: lookup by receipt number, transaction reference or member.
      where = `WHERE r.receipt_number ILIKE $1 OR p.external_reference ILIKE $1
               OR m.first_name || ' ' || coalesce(m.last_name,'') ILIKE $1
               OR m.membership_number ILIKE $1`;
    }
    params.push(pageSize, (pageNum - 1) * pageSize);
    const r = await tx.query(
      `SELECT p.id, p.amount::bigint::text AS amount, p.method, p.status,
              p.payment_date::text AS payment_date, p.external_reference,
              m.first_name || coalesce(' ' || m.last_name,'') AS member_name, m.id AS member_id,
              r.receipt_number
       FROM payments p
       JOIN members m ON m.id = p.member_id
       LEFT JOIN receipts r ON r.payment_id = p.id
       ${where}
       ORDER BY p.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return r.rows as Record<string, string>[];
  });

  return (
    <>
      <PageHeader title={tr.payments.title} />
      <form className="mb-4 flex gap-2" action="/payments" method="get">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder={`${tr.payments.receiptNumber} / ${tr.payments.reference} / ${tr.members.name}`}
          className={`${inputCls} max-w-md`}
        />
        <Button variant="secondary">{tr.common.search}</Button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title="No payments recorded yet." />
      ) : (
        <Table
          headers={[
            tr.payments.date,
            tr.members.name,
            tr.payments.amount,
            tr.payments.method,
            tr.payments.receiptNumber,
            tr.members.status,
          ]}
        >
          {rows.map((p) => (
            <tr key={p.id}>
              <td className="px-4 py-3">{formatDisplayDate(p.payment_date!)}</td>
              <td className="px-4 py-3">
                <Link href={`/members/${p.member_id}`} className="hover:text-primary">
                  {p.member_name}
                </Link>
              </td>
              <td className="px-4 py-3 font-medium">{formatMoney(Number(p.amount))}</td>
              <td className="px-4 py-3">
                {tr.payments.methods[p.method as keyof typeof tr.payments.methods] ?? p.method}
              </td>
              <td className="px-4 py-3">
                {p.receipt_number ? (
                  <Link href={`/receipts/${p.id}`} className="text-primary hover:underline">
                    {p.receipt_number}
                  </Link>
                ) : (
                  '—'
                )}
              </td>
              <td className="px-4 py-3">
                <Badge
                  tone={
                    p.status === 'completed'
                      ? 'success'
                      : p.status?.includes('refund')
                        ? 'warning'
                        : 'muted'
                  }
                >
                  {p.status}
                </Badge>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <div className="mt-4 flex justify-center gap-2 text-sm">
        {pageNum > 1 ? (
          <Link className="rounded-lg border px-3 py-1.5" href={`/payments?page=${pageNum - 1}`}>
            ←
          </Link>
        ) : null}
        {rows.length === pageSize ? (
          <Link className="rounded-lg border px-3 py-1.5" href={`/payments?page=${pageNum + 1}`}>
            →
          </Link>
        ) : null}
      </div>
    </>
  );
}
