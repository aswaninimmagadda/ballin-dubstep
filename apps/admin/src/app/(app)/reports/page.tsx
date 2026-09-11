import { addDays, formatDisplayDate, formatMoney, todayInTz } from '@gymflow/utils';
import { hasPermission } from '@gymflow/core';
import { requirePermission } from '@/lib/session';
import { collectionsReport, planMixReport } from '@/lib/services/reports';
import { asPrincipal } from '@/lib/db';
import { t } from '@/lib/i18n';
import { Button, Card, PageHeader, Table, inputCls } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; branch?: string; method?: string }>;
}) {
  const user = await requirePermission('reports.view');
  const today = todayInTz();
  const { from = addDays(today, -30), to = today, branch, method } = await searchParams;
  const tr = await t();
  const [collections, planMix, branches] = await Promise.all([
    collectionsReport(user, { from, to, branchId: branch, method }),
    planMixReport(user),
    asPrincipal(user.claims, async (tx) => {
      const r = await tx.query(`SELECT id, name FROM branches WHERE is_active ORDER BY name`);
      return r.rows as { id: string; name: string }[];
    }),
  ]);
  const canExport =
    hasPermission(user.permissions, 'reports.export') || user.kind === 'platform_admin';

  return (
    <>
      <PageHeader
        title={tr.nav.reports}
        actions={
          canExport ? (
            <>
              <Button href="/api/export/members" variant="secondary">
                Members CSV
              </Button>
              <Button href="/api/export/payments" variant="secondary">
                Payments CSV
              </Button>
              <Button href="/api/export/memberships" variant="secondary">
                Memberships CSV
              </Button>
              <Button href="/api/export/dues" variant="secondary">
                Dues CSV
              </Button>
              <Button href="/api/export/attendance" variant="secondary">
                Attendance CSV
              </Button>
            </>
          ) : undefined
        }
      />

      <form className="mb-4 flex flex-wrap items-end gap-2" action="/reports" method="get">
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">From</span>
          <input type="date" name="from" defaultValue={from} className={inputCls} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">To</span>
          <input type="date" name="to" defaultValue={to} className={inputCls} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">Branch</span>
          <select name="branch" defaultValue={branch ?? ''} className={inputCls}>
            <option value="">All</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">{tr.payments.method}</span>
          <select name="method" defaultValue={method ?? ''} className={inputCls}>
            <option value="">All</option>
            {Object.entries(tr.payments.methods).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <Button variant="secondary">Apply</Button>
      </form>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-1 text-sm font-semibold text-slate-700">
            Collections {formatDisplayDate(from)} – {formatDisplayDate(to)}
          </h2>
          <p className="text-3xl font-bold">{formatMoney(Number(collections.total))}</p>
          {Number(collections.refunds) > 0 ? (
            <p className="mb-4 mt-1 text-sm text-slate-500">
              net · {formatMoney(Number(collections.gross))} received less{' '}
              <span className="font-medium text-amber-700">
                {formatMoney(Number(collections.refunds))}
              </span>{' '}
              refunded
            </p>
          ) : (
            <p className="mb-4 mt-1 text-sm text-slate-500">no refunds in this period</p>
          )}
          <Table headers={[tr.payments.method, tr.ui.count, tr.payments.amount]}>
            {collections.byMethod.map((m) => (
              <tr key={m.method}>
                <td className="px-4 py-3">
                  {tr.payments.methods[m.method as keyof typeof tr.payments.methods] ?? m.method}
                </td>
                <td className="px-4 py-3">{m.count}</td>
                <td className="px-4 py-3 font-medium">{formatMoney(Number(m.total))}</td>
              </tr>
            ))}
          </Table>
        </Card>

        {/* Who took the money. received_by has been on every payment since
            the first migration and was only ever visible on an individual
            receipt, so closing the till meant opening receipts one at a
            time. */}
        <Card>
          <h2 className="text-sm font-semibold text-slate-700">{tr.payments.cashUp}</h2>
          <p className="mb-4 mt-1 text-xs text-slate-600">{tr.payments.cashUpHint}</p>
          {collections.byCollector.length === 0 ? (
            <p className="text-sm text-slate-600">{tr.payments.noCollections}</p>
          ) : (
            <Table
              headers={[
                tr.payments.collector,
                tr.ui.count,
                tr.payments.cashColumn,
                tr.payments.otherColumn,
                tr.payments.amount,
              ]}
            >
              {collections.byCollector.map((c) => (
                <tr key={c.user_id ?? 'unattributed'}>
                  <td className="px-4 py-3">{c.name}</td>
                  <td className="px-4 py-3">{c.count}</td>
                  <td className="px-4 py-3 font-semibold tabular-nums">
                    {formatMoney(Number(c.cash))}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">
                    {formatMoney(Number(c.other))}
                  </td>
                  <td className="px-4 py-3 font-medium tabular-nums">
                    {formatMoney(Number(c.total))}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-300 font-semibold">
                <td className="px-4 py-3">{tr.membership.total}</td>
                <td className="px-4 py-3">
                  {collections.byCollector.reduce((n, c) => n + c.count, 0)}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {formatMoney(collections.byCollector.reduce((n, c) => n + Number(c.cash), 0))}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {formatMoney(collections.byCollector.reduce((n, c) => n + Number(c.other), 0))}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {formatMoney(collections.byCollector.reduce((n, c) => n + Number(c.total), 0))}
                </td>
              </tr>
            </Table>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-semibold text-slate-700">
            Membership plan mix (all time)
          </h2>
          {/* "Revenue" used to be sum(total_amount) over every membership row
              with no filter — cancelled, never-paid and refunded ones all
              counted as money earned, printed next to a cash figure. These two
              columns are what actually arrived and what is still owed. */}
          <Table headers={[tr.members.plan, 'Active', 'Collected', 'Outstanding']}>
            {planMix.map((p) => (
              <tr key={p.plan_name}>
                <td className="px-4 py-3">{p.plan_name}</td>
                <td className="px-4 py-3">{p.active_count}</td>
                <td className="px-4 py-3 font-medium">{formatMoney(Number(p.collected))}</td>
                <td className="px-4 py-3 text-amber-700">
                  {Number(p.outstanding) > 0 ? formatMoney(Number(p.outstanding)) : '—'}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
