import Link from 'next/link';
import { formatDisplayDate, maskPhone, whatsappLink } from '@gymflow/utils';
import { renderTemplate } from '@gymflow/i18n';
import { requirePermission } from '@/lib/session';
import { listRenewals, isRenewalWindow, type RenewalWindow } from '@/lib/services/renewals';
import { getSettings } from '@/lib/services/settings';
import { t, currentLanguage } from '@/lib/i18n';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

/**
 * The whole renewal queue, not the first 30 of it.
 *
 * The dashboard card is a preview; this is the list a gym actually works
 * through. Every row carries the same three actions the card does — call,
 * WhatsApp, renew — because a drill-down you cannot act from is just a
 * longer way to read the same names.
 */
export default async function RenewalsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string; page?: string }>;
}) {
  const user = await requirePermission('members.view');
  const sp = await searchParams;
  const window: RenewalWindow = isRenewalWindow(sp.window) ? sp.window : '7';
  const pageNum = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const [tr, lang, settings, { rows, total }] = await Promise.all([
    t(),
    currentLanguage(),
    getSettings(user),
    listRenewals(user, {
      window,
      limit: PAGE_SIZE,
      offset: (pageNum - 1) * PAGE_SIZE,
    }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const template =
    (lang === 'te'
      ? settings?.whatsapp_renewal_template_te
      : settings?.whatsapp_renewal_template_en) ?? '';

  const WINDOWS: { key: RenewalWindow; label: string }[] = [
    { key: 'overdue', label: tr.dashboard.windowOverdue },
    { key: 'queue', label: tr.dashboard.windowQueue },
    { key: 'today', label: tr.dashboard.windowToday },
    { key: '7', label: tr.dashboard.window7 },
    { key: '15', label: tr.dashboard.window15 },
    { key: '30', label: tr.dashboard.window30 },
  ];

  return (
    <>
      <PageHeader
        title={tr.dashboard.renewalsTitle}
        subtitle={renderTemplate(tr.dashboard.renewalsSubtitle, { total: String(total) })}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {WINDOWS.map((w) => (
          <Link
            key={w.key}
            href={`/renewals?window=${w.key}`}
            // aria-current, not colour alone: which window is selected has to
            // reach someone who cannot see the fill.
            aria-current={w.key === window ? 'page' : undefined}
            className={
              w.key === window
                ? 'flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-white'
                : 'flex min-h-11 items-center rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50'
            }
          >
            {w.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState title={tr.dashboard.renewalsNone} hint={tr.dashboard.renewalsNoneHint} />
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const overdue = row.days_left < 0;
            const wa = whatsappLink(
              row.mobile,
              renderTemplate(template, {
                member_first_name: row.first_name,
                gym_name: settings?.tenant_name ?? '',
                expiry_date: formatDisplayDate(row.end_date),
              }),
            );
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
                    {row.plan_name} · {formatDisplayDate(row.end_date)} · {maskPhone(row.mobile)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={overdue ? 'danger' : row.days_left <= 3 ? 'warning' : 'default'}>
                    {overdue
                      ? renderTemplate(tr.ui.daysOverdue, { days: String(-row.days_left) })
                      : renderTemplate(tr.ui.daysShort, { days: String(row.days_left) })}
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
                    className="rounded-lg bg-green-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-800"
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

      {pages > 1 ? (
        <div className="mt-4 flex items-center justify-center gap-2 text-sm">
          {pageNum > 1 ? (
            <Link
              className="flex min-h-11 items-center rounded-lg border px-4"
              href={`/renewals?window=${window}&page=${pageNum - 1}`}
              aria-label={tr.ui.previousPage}
            >
              <span aria-hidden="true">←</span>
            </Link>
          ) : null}
          <span className="text-slate-600">
            {pageNum} / {pages}
          </span>
          {pageNum < pages ? (
            <Link
              className="flex min-h-11 items-center rounded-lg border px-4"
              href={`/renewals?window=${window}&page=${pageNum + 1}`}
              aria-label={tr.ui.nextPage}
            >
              <span aria-hidden="true">→</span>
            </Link>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
