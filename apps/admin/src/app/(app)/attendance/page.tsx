import { redirect } from 'next/navigation';
import { formatDisplayDate } from '@gymflow/utils';
import { requirePermission } from '@/lib/session';
import { searchMembers } from '@/lib/services/members';
import {
  checkinMember,
  previewCheckin,
  todayCheckins,
  resolveQrToken,
} from '@/lib/services/attendance';
import { toUserMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { requireFeature } from '@/lib/flags';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  PageHeader,
  SuccessBanner,
  Table,
  inputCls,
} from '@/components/ui';

export const dynamic = 'force-dynamic';

async function checkinAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('attendance.checkin');
  const memberId = String(formData.get('memberId'));
  const override = formData.get('override') === '1';
  try {
    const result = await checkinMember(user, { memberId, method: 'reception', override });
    redirect(
      `/attendance?msg=${result.ok ? 'ok' : 'blocked' in result && result.blocked ? 'blocked' : 'duplicate'}`,
    );
  } catch (err) {
    if ((err as { digest?: string }).digest?.startsWith('NEXT_REDIRECT')) throw err;
    redirect(`/attendance?error=${encodeURIComponent(toUserMessage(err))}`);
  }
}

async function qrAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('attendance.checkin');
  const token = String(formData.get('token') ?? '');
  try {
    const memberId = await resolveQrToken(user, token);
    redirect(`/attendance?preview=${memberId}`);
  } catch (err) {
    if ((err as { digest?: string }).digest?.startsWith('NEXT_REDIRECT')) throw err;
    redirect(`/attendance?error=${encodeURIComponent(toUserMessage(err))}`);
  }
}

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; preview?: string; msg?: string; error?: string }>;
}) {
  const user = await requirePermission('attendance.checkin');
  await requireFeature(user, 'attendance');
  const { q = '', preview, msg, error } = await searchParams;
  const tr = await t();

  const results = q ? (await searchMembers(user, { q, limit: 8 })).rows : [];
  const previewData = preview ? await previewCheckin(user, preview).catch(() => null) : null;
  const today = await todayCheckins(user);

  return (
    <>
      <PageHeader title={tr.attendance.title} />
      <SuccessBanner message={msg === 'ok' ? '✓ ' + tr.attendance.checkIn : null} />
      <ErrorBanner
        message={
          msg === 'duplicate'
            ? tr.attendance.alreadyCheckedIn
            : msg === 'blocked'
              ? tr.attendance.memberExpired
              : (error ?? null)
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <Card>
            <form action="/attendance" method="get" className="flex gap-2">
              <input
                type="search"
                name="q"
                defaultValue={q}
                autoFocus
                placeholder={tr.attendance.searchToCheckIn}
                className={inputCls}
              />
              <Button variant="secondary">{tr.common.search}</Button>
            </form>
            <form action={qrAction} className="mt-3 flex gap-2">
              <input
                name="token"
                placeholder={tr.attendance.scanQr}
                className={inputCls}
                aria-label={tr.attendance.scanQr}
              />
              <Button variant="secondary">QR</Button>
            </form>

            {results.length > 0 ? (
              <ul className="mt-4 divide-y divide-slate-100">
                {results.map((m) => (
                  <li key={m.id} className="flex items-center justify-between py-2">
                    <div>
                      <span className="text-sm font-medium">
                        {m.first_name} {m.last_name ?? ''}
                      </span>
                      <span className="ml-2 text-xs text-slate-400">{m.membership_number}</span>
                    </div>
                    <a
                      href={`/attendance?preview=${m.id}`}
                      className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark"
                    >
                      {tr.common.next}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>

          {previewData ? (
            <Card className={`mt-4 ${previewData.allowed ? 'border-green-300' : 'border-red-300'}`}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-lg font-bold">{previewData.name}</p>
                  <p className="text-sm text-slate-500">
                    {previewData.membershipNumber}
                    {previewData.planName ? ` · ${previewData.planName}` : ''}
                    {previewData.endDate ? ` · ${formatDisplayDate(previewData.endDate)}` : ''}
                  </p>
                  {previewData.warning === 'expired' ? (
                    <p className="mt-1 text-sm font-medium text-red-600">
                      {tr.attendance.memberExpired}
                    </p>
                  ) : previewData.warning === 'frozen' ? (
                    <p className="mt-1 text-sm font-medium text-amber-600">
                      {tr.attendance.memberFrozen}
                    </p>
                  ) : previewData.warning === 'grace' ? (
                    // The service has always computed this and the screen had
                    // no branch for it, so a member inside their grace period
                    // — the one moment a renewal conversation is easy — was
                    // waved through looking exactly like everyone else.
                    <p className="mt-1 text-sm font-medium text-amber-600">
                      {tr.attendance.memberGrace}
                    </p>
                  ) : previewData.warning === 'expiring_soon' ? (
                    <p className="mt-1 text-sm font-medium text-amber-600">
                      {tr.attendance.memberExpiringSoon}
                    </p>
                  ) : null}
                </div>
                <form action={checkinAction} className="flex flex-col gap-2">
                  <input type="hidden" name="memberId" value={previewData.memberId} />
                  {previewData.allowed ? (
                    <Button>{tr.attendance.checkIn}</Button>
                  ) : (
                    <>
                      <input type="hidden" name="override" value="1" />
                      <Button variant="danger">{tr.attendance.allowAnyway}</Button>
                      <Button
                        href={`/members/${previewData.memberId}/renew`}
                        variant="secondary"
                        type="button"
                      >
                        {tr.members.renew}
                      </Button>
                    </>
                  )}
                </form>
              </div>
            </Card>
          ) : null}
        </div>

        <section>
          <h2 className="mb-3 text-base font-semibold">
            {tr.dashboard.todayAttendance} ({today.length})
          </h2>
          {today.length === 0 ? (
            <p className="text-sm text-slate-500">No check-ins yet today.</p>
          ) : (
            <Table headers={[tr.members.name, tr.attendance.checkedInAt, 'Method']}>
              {today.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3">
                    {row.name}{' '}
                    <span className="text-xs text-slate-400">{row.membership_number}</span>
                  </td>
                  <td className="px-4 py-3">
                    {new Date(row.checked_in_at).toLocaleTimeString('en-IN', {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'Asia/Kolkata',
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone="muted">{row.method}</Badge>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </section>
      </div>
    </>
  );
}
