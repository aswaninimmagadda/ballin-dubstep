import Link from 'next/link';
import { formatMoney, formatDisplayDate, maskPhone, whatsappLink } from '@gymflow/utils';
import { renderTemplate } from '@gymflow/i18n';
import { requirePermission } from '@/lib/session';
import { getDashboard } from '@/lib/services/dashboard';
import { t, currentLanguage } from '@/lib/i18n';
import { Badge, Button, Card, PageHeader, StatCard, Table, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await requirePermission('members.view');
  const [data, tr, lang] = await Promise.all([getDashboard(user), t(), currentLanguage()]);

  return (
    <>
      <PageHeader
        title={tr.dashboard.title}
        actions={
          <>
            <Button href="/members/new">{tr.dashboard.quickNewMember}</Button>
            <Button href="/members" variant="secondary">
              {tr.dashboard.quickFindMember}
            </Button>
            <Button href="/attendance" variant="secondary">
              {tr.dashboard.quickCheckIn}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label={tr.dashboard.activeMembers}
          value={data.activeMembers}
          tone="success"
          href="/members?status=active"
        />
        <StatCard label={tr.dashboard.expiring7Days} value={data.expiring7Days} tone="warning" />
        <StatCard
          label={tr.dashboard.expiredMembers}
          value={data.expiredRecent}
          tone="danger"
          href="/members?status=expired"
        />
        <StatCard
          label={tr.dashboard.todayAttendance}
          value={data.todayAttendance}
          href="/attendance"
        />
        <StatCard
          label={tr.dashboard.todayCollections}
          value={formatMoney(data.todayCollections)}
        />
        <StatCard
          label={tr.dashboard.monthCollections}
          value={formatMoney(data.monthCollections)}
        />
        <StatCard label={tr.dashboard.newMembersMonth} value={data.newMembersThisMonth} />
        <StatCard
          label={tr.dashboard.duesOutstanding}
          value={formatMoney(data.duesOutstanding)}
          tone={data.duesOutstanding > 0 ? 'warning' : 'default'}
          href="/members?dues=1"
        />
        <StatCard label={tr.dashboard.leadsFollowUp} value={data.leadsToFollowUp} href="/leads" />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-lg font-semibold text-slate-900">{tr.dashboard.expiryQueue}</h2>
          {data.expiryQueue.length === 0 ? (
            <EmptyState title="No memberships expiring in the next 7 days." />
          ) : (
            <div className="space-y-2">
              {data.expiryQueue.map((row) => {
                const wa = whatsappLink(
                  row.mobile,
                  renderTemplate(lang === 'te' ? data.waTemplateTe : data.waTemplateEn, {
                    member_first_name: row.first_name,
                    gym_name: data.gymName,
                    expiry_date: formatDisplayDate(row.end_date),
                  }),
                );
                const overdue = row.days_left < 0;
                return (
                  <Card
                    key={row.membership_id}
                    className="flex flex-wrap items-center justify-between gap-3"
                  >
                    <div>
                      <Link
                        href={`/members/${row.member_id}`}
                        className="font-semibold text-slate-900 hover:text-primary"
                      >
                        {row.first_name} {row.last_name ?? ''}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {row.plan_name} · {formatDisplayDate(row.end_date)} ·{' '}
                        {maskPhone(row.mobile)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={overdue ? 'danger' : row.days_left <= 3 ? 'warning' : 'default'}>
                        {overdue
                          ? `${-row.days_left}d ${tr.members.statuses.expired}`
                          : `${row.days_left}d`}
                      </Badge>
                      <a
                        href={`tel:${row.mobile}`}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        {tr.members.call}
                      </a>
                      <a
                        href={wa}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700"
                      >
                        {tr.members.whatsapp}
                      </a>
                      <Link
                        href={`/members/${row.member_id}/renew`}
                        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark"
                      >
                        {tr.members.renew}
                      </Link>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-slate-900">
            {tr.dashboard.recentPayments}
          </h2>
          {data.recentPayments.length === 0 ? (
            <EmptyState title="No payments yet." />
          ) : (
            <Table
              headers={[
                tr.members.name,
                tr.payments.amount,
                tr.payments.method,
                tr.payments.receiptNumber,
              ]}
            >
              {data.recentPayments.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3">{p.member_name}</td>
                  <td className="px-4 py-3 font-medium">{formatMoney(Number(p.amount))}</td>
                  <td className="px-4 py-3">
                    <Badge>
                      {tr.payments.methods[p.method as keyof typeof tr.payments.methods] ??
                        p.method}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{p.receipt_number ?? '—'}</td>
                </tr>
              ))}
            </Table>
          )}
        </section>
      </div>
    </>
  );
}
