import { Suspense } from 'react';
import Link from 'next/link';
import { formatDisplayDate, formatMoney } from '@gymflow/utils';
import { renderTemplate, type TranslationTree } from '@gymflow/i18n';
import { requirePermission } from '@/lib/session';
import { searchMembers } from '@/lib/services/members';
import { t } from '@/lib/i18n';
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Table,
  inputCls,
  statusTone,
} from '@/components/ui';
import { PageSkeleton } from '@/components/boundary';

export const dynamic = 'force-dynamic';

interface MemberQuery {
  q?: string;
  status?: string;
  page?: string;
  dues?: string;
  archived?: string;
}

/**
 * The search box and the toolbar do not need the database, so they paint
 * immediately and the results stream in behind a skeleton. Reception can
 * start typing the next search before the previous one has finished
 * arriving, which on a gym's tethered connection is the difference between
 * "slow" and "broken".
 *
 * This is an in-page Suspense boundary rather than a route-level
 * loading.tsx on purpose: loading.tsx would wrap this segment AND its
 * children, and every members/[id] page calls notFound(). Streaming commits
 * HTTP 200 before the page body runs, so those 404s would silently become
 * 200s. See the note in components/boundary.tsx.
 */
export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<MemberQuery>;
}) {
  await requirePermission('members.view');
  const params = await searchParams;
  const tr = await t();
  return (
    <>
      <PageHeader
        title={tr.members.title}
        actions={
          <>
            <Button href="/members/import" variant="secondary">
              {tr.ui.importMembersFromCsv}
            </Button>
            <Button href="/members/new">{tr.members.newMember}</Button>
          </>
        }
      />
      <MemberSearchForm params={params} tr={tr} />
      <Suspense key={JSON.stringify(params)} fallback={<PageSkeleton rows={10} />}>
        <MemberResults params={params} />
      </Suspense>
    </>
  );
}

function MemberSearchForm({ params, tr }: { params: MemberQuery; tr: TranslationTree }) {
  const { q = '', status, dues, archived } = params;
  return (
    <form className="mb-4 flex flex-wrap gap-2" action="/members" method="get">
      <input
        type="search"
        name="q"
        defaultValue={q}
        placeholder={tr.attendance.searchToCheckIn}
        className={`${inputCls} max-w-xs`}
        autoFocus
      />
      <select name="status" defaultValue={status ?? ''} className={`${inputCls} max-w-44`}>
        <option value="">{tr.members.status}: —</option>
        {Object.entries(tr.members.statuses).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm text-slate-600">
        <input type="checkbox" name="dues" value="1" defaultChecked={dues === '1'} />
        {tr.members.duesOnly}
      </label>
      <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm text-slate-600">
        <input type="checkbox" name="archived" value="1" defaultChecked={archived === '1'} />
        {tr.members.showArchived}
      </label>
      <Button variant="secondary">{tr.common.search}</Button>
    </form>
  );
}

async function MemberResults({ params }: { params: MemberQuery }) {
  const user = await requirePermission('members.view');
  const { q = '', status, page = '1', dues, archived } = params;
  const duesOnly = dues === '1';
  // Archiving had no reverse anywhere in the product; this is how an archived
  // member is found again. `status=archived` used to be an option in the
  // filter that could never match, because the list always excluded them.
  const showArchived = archived === '1';
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = 25;
  const [tr, { rows, total }] = await Promise.all([
    t(),
    searchMembers(user, {
      q,
      status: showArchived ? undefined : status,
      duesOnly,
      archived: showArchived,
      limit: pageSize,
      offset: (pageNum - 1) * pageSize,
    }),
  ]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const qs = (extra: Record<string, string | number>) =>
    new URLSearchParams({
      q,
      status: status ?? '',
      ...(duesOnly ? { dues: '1' } : {}),
      ...(showArchived ? { archived: '1' } : {}),
      ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])),
    }).toString();

  return (
    <>
      <p className="mb-2 text-sm text-slate-600">
        {renderTemplate(tr.members.countShown, { total: String(total) })}
      </p>

      {rows.length === 0 ? (
        <EmptyState
          title={showArchived ? tr.members.noArchived : tr.members.noneFound}
          hint={showArchived ? undefined : tr.members.noneFoundHint}
        />
      ) : (
        <Table
          headers={[
            '#',
            tr.members.name,
            tr.members.mobile,
            tr.members.plan,
            tr.members.expiry,
            tr.members.due,
            tr.members.status,
          ]}
        >
          {rows.map((m) => (
            <tr key={m.id} className="hover:bg-slate-50">
              <td className="px-4 py-3 text-slate-500">{m.membership_number}</td>
              <td className="px-4 py-3">
                <Link
                  href={`/members/${m.id}`}
                  className="font-medium text-slate-900 hover:text-primary"
                >
                  {m.first_name} {m.last_name ?? ''}
                </Link>
                <span className="block text-xs text-slate-500">{m.branch_name}</span>
              </td>
              <td className="px-4 py-3">{m.mobile.replace('+91', '')}</td>
              <td className="px-4 py-3">{m.plan_name ?? '—'}</td>
              <td className="px-4 py-3">{m.end_date ? formatDisplayDate(m.end_date) : '—'}</td>
              <td className="px-4 py-3">
                {Number(m.due_amount ?? 0) > 0 ? (
                  <span className="font-semibold text-amber-700">
                    {formatMoney(Number(m.due_amount))}
                  </span>
                ) : (
                  <span className="text-slate-500">—</span>
                )}
              </td>
              <td className="px-4 py-3">
                <Badge tone={statusTone(m.status)}>
                  {tr.members.statuses[m.status as keyof typeof tr.members.statuses] ?? m.status}
                </Badge>
              </td>
            </tr>
          ))}
        </Table>
      )}

      {pages > 1 ? (
        <div className="mt-4 flex items-center justify-center gap-2 text-sm">
          {pageNum > 1 ? (
            <Link
              className="rounded-lg border px-3 py-1.5"
              href={`/members?${qs({ page: pageNum - 1 })}`}
            >
              ←
            </Link>
          ) : null}
          <span className="text-slate-500">
            {pageNum} / {pages}
          </span>
          {pageNum < pages ? (
            <Link
              className="rounded-lg border px-3 py-1.5"
              href={`/members?${qs({ page: pageNum + 1 })}`}
            >
              →
            </Link>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
