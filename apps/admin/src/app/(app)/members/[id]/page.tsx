import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { formatDisplayDate, formatMoney, maskPhone } from '@gymflow/utils';
import { deriveMembershipStatus, daysRemaining } from '@gymflow/core';
import { todayInTz } from '@gymflow/utils';
import { requirePermission } from '@/lib/session';
import { getMemberDetail } from '@/lib/services/members';
import { checkinMember } from '@/lib/services/attendance';
import { renewalWhatsappLink } from '@/lib/services/settings';
import { unfreezeMembership } from '@/lib/services/memberships';
import { t } from '@/lib/i18n';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  PageHeader,
  SuccessBanner,
  Table,
  statusTone,
} from '@/components/ui';

export const dynamic = 'force-dynamic';

async function quickCheckinAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('attendance.checkin');
  const memberId = String(formData.get('memberId'));
  const result = await checkinMember(user, { memberId, method: 'reception' });
  redirect(
    `/members/${memberId}?msg=${result.ok ? 'checkedin' : 'blocked' in result && result.blocked ? 'blocked' : 'duplicate'}`,
  );
}

async function unfreezeAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('memberships.freeze');
  const memberId = String(formData.get('memberId'));
  const membershipId = String(formData.get('membershipId'));
  await unfreezeMembership(user, { membershipId, actualEndDate: todayInTz() });
  redirect(`/members/${memberId}?msg=unfrozen`);
}

async function archiveAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('members.edit');
  const memberId = String(formData.get('memberId'));
  const { archiveMember } = await import('@/lib/services/members');
  try {
    await archiveMember(user, memberId);
  } catch (err) {
    const { toUserMessage } = await import('@/lib/errors');
    redirect(`/members/${memberId}?msg=archerror&detail=${encodeURIComponent(toUserMessage(err))}`);
  }
  redirect(`/members/${memberId}?msg=archived`);
}

async function unarchiveAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('members.edit');
  const memberId = String(formData.get('memberId'));
  const { unarchiveMember } = await import('@/lib/services/members');
  try {
    await unarchiveMember(user, memberId);
  } catch (err) {
    const { toUserMessage } = await import('@/lib/errors');
    redirect(`/members/${memberId}?msg=archerror&detail=${encodeURIComponent(toUserMessage(err))}`);
  }
  redirect(`/members/${memberId}?msg=unarchived`);
}

async function logPtAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('pt.manage');
  const memberId = String(formData.get('memberId'));
  const { logPtSession } = await import('@/lib/services/addons');
  try {
    await logPtSession(user, { memberAddonId: String(formData.get('memberAddonId')) });
  } catch (err) {
    const { toUserMessage } = await import('@/lib/errors');
    redirect(`/members/${memberId}?msg=pterror&detail=${encodeURIComponent(toUserMessage(err))}`);
  }
  redirect(`/members/${memberId}?msg=ptlogged`);
}

export default async function MemberDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string; detail?: string }>;
}) {
  const user = await requirePermission('members.view');
  const { id } = await params;
  const { msg, detail: errorDetail } = await searchParams;
  const [detail, tr] = await Promise.all([getMemberDetail(user, id), t()]);
  if (!detail) notFound();
  const {
    member,
    currentMembership,
    memberships,
    payments,
    attendance,
    addons,
    openFreeze,
    deletionRequestedAt,
  } = detail;
  const today = todayInTz();
  const wa = await renewalWhatsappLink(user, { memberId: id });

  const derived = currentMembership
    ? deriveMembershipStatus(
        {
          state: currentMembership.state as never,
          startDate: String(currentMembership.start_date),
          endDate: String(currentMembership.end_date),
          gracePeriodDays: Number(currentMembership.grace_period_days),
        },
        today,
      )
    : null;
  const daysLeft = currentMembership
    ? daysRemaining(String(currentMembership.end_date), today)
    : null;

  const messages: Record<string, string> = {
    checkedin: `${tr.attendance.checkIn} ✓`,
    duplicate: tr.attendance.alreadyCheckedIn,
    blocked: tr.attendance.memberExpired,
    ptlogged: 'PT session logged.',
    pterror: errorDetail ?? tr.common.error,
    sold: 'Membership recorded.',
    renewed: 'Renewal recorded.',
    frozen: 'Membership frozen.',
    unfrozen: 'Membership resumed.',
    paid: 'Payment recorded.',
    addon: 'Add-on recorded.',
    edited: 'Member updated.',
    cancelled: 'Membership cancelled.',
    archived:
      'Member archived. Their history is kept; the mobile number is free to re-use. Find them again with the "Archived only" filter on the members list.',
    unarchived: tr.members.unarchived,
    archerror: errorDetail ?? tr.common.error,
  };

  return (
    <>
      {msg === 'blocked' || msg === 'pterror' || msg === 'archerror' ? (
        <ErrorBanner message={messages[msg]} />
      ) : (
        <SuccessBanner message={msg ? messages[msg] : null} />
      )}
      {deletionRequestedAt ? (
        <ErrorBanner
          message={`This member asked to have their data deleted on ${formatDisplayDate(deletionRequestedAt.slice(0, 10))}. Their app login is already removed. Erase the personal details you no longer need, keeping financial records.`}
        />
      ) : null}
      <PageHeader
        title={`${member.first_name} ${member.last_name ?? ''}`}
        subtitle={`${tr.members.memberNumber} ${member.membership_number} · ${maskPhone(String(member.mobile))} · ${String(member.branch_name)}`}
        actions={
          <>
            <form action={quickCheckinAction}>
              <input type="hidden" name="memberId" value={id} />
              <Button variant="secondary">{tr.members.checkIn}</Button>
            </form>
            <Button href={`/members/${id}/renew`}>{tr.members.renew}</Button>
            <Button href={`/members/${id}/payment`} variant="secondary">
              {tr.members.recordPayment}
            </Button>
            <Button href={`/members/${id}/addon`} variant="secondary">
              PT
            </Button>
            <Button href={`/members/${id}/edit`} variant="secondary">
              Edit
            </Button>
            {wa ? (
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                className="btn inline-flex min-h-11 items-center rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700"
              >
                {tr.members.whatsapp}
              </a>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          {currentMembership ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold">
                    {String(currentMembership.plan_name_snapshot)}
                  </span>
                  <Badge tone={statusTone(derived ?? '')}>
                    {tr.membership.statuses[derived as keyof typeof tr.membership.statuses] ??
                      derived}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {formatDisplayDate(String(currentMembership.start_date))} →{' '}
                  {formatDisplayDate(String(currentMembership.end_date))}
                </p>
                {daysLeft != null && daysLeft >= 0 ? (
                  <p className="text-sm font-medium text-slate-700">
                    {daysLeft} {tr.members.daysRemaining}
                  </p>
                ) : null}
                {member.trainer_name ? (
                  <p className="mt-1 text-sm text-slate-500">
                    {tr.members.trainer}: {String(member.trainer_name)}
                  </p>
                ) : null}
                {Number(currentMembership.due_amount ?? 0) > 0 ? (
                  <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                    {tr.members.due}: {formatMoney(Number(currentMembership.due_amount))}
                    <span className="ml-1 font-normal text-amber-700">
                      ({tr.members.paid} {formatMoney(Number(currentMembership.paid_amount ?? 0))} /{' '}
                      {formatMoney(Number(currentMembership.total_amount))})
                    </span>
                  </p>
                ) : null}
              </div>
              <div className="flex gap-2">
                {currentMembership.state === 'frozen' && openFreeze ? (
                  <form action={unfreezeAction}>
                    <input type="hidden" name="memberId" value={id} />
                    <input type="hidden" name="membershipId" value={String(currentMembership.id)} />
                    <Button variant="secondary">{tr.members.unfreeze}</Button>
                  </form>
                ) : currentMembership.state === 'active' ? (
                  <Button href={`/members/${id}/freeze`} variant="secondary">
                    {tr.members.freeze}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">No active membership.</p>
              <Button href={`/members/${id}/sell`}>{tr.membership.sell}</Button>
            </div>
          )}
          {openFreeze ? (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {tr.members.freeze}: {String(openFreeze.start_date)} →{' '}
              {openFreeze.planned_end_date ? String(openFreeze.planned_end_date) : '…'} ·{' '}
              {String(openFreeze.reason)}
            </p>
          ) : null}
        </Card>

        <Card>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">{tr.members.overview}</h3>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">{tr.members.joinDate}</dt>
              <dd>{formatDisplayDate(String(member.join_date))}</dd>
            </div>
            {member.village ? (
              <div className="flex justify-between">
                <dt className="text-slate-500">{tr.members.village}</dt>
                <dd>{String(member.village)}</dd>
              </div>
            ) : null}
            {member.emergency_contact_name || member.emergency_contact_phone ? (
              <div className="flex justify-between">
                <dt className="text-slate-500">{tr.members.emergencyContact}</dt>
                <dd className="text-right">
                  {String(member.emergency_contact_name ?? '')}
                  {member.emergency_contact_phone ? (
                    <span className="block text-xs text-slate-500">
                      {String(member.emergency_contact_phone)}
                    </span>
                  ) : null}
                </dd>
              </div>
            ) : null}
            <div className="flex justify-between">
              <dt className="text-slate-500">{tr.members.status}</dt>
              <dd>
                <Badge tone={statusTone(String(member.status))}>
                  {tr.members.statuses[member.status as keyof typeof tr.members.statuses] ??
                    String(member.status)}
                </Badge>
              </dd>
            </div>
          </dl>
          {member.notes ? (
            <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {tr.members.notes}: {String(member.notes)}
            </p>
          ) : null}
          <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-3">
            {/* The same action both enables access and reissues the password:
                app.member_app_enable upserts the credential. Hiding it once
                access existed meant a member who forgot their app password
                could not be given a new one by anyone, at any desk. */}
            <form action="/credentials" method="post">
              <input type="hidden" name="kind" value="member_app" />
              <input type="hidden" name="memberId" value={id} />
              <button className="text-sm font-semibold text-primary hover:underline">
                {member.user_id ? tr.members.appAccessReset : tr.members.appAccessEnable}
              </button>
              {member.user_id ? (
                <p className="mt-1 text-xs text-slate-400">
                  {tr.members.appAccessEnabled} · {tr.members.appAccessResetHint}
                </p>
              ) : null}
            </form>
            {currentMembership ? (
              <a
                href={`/members/${id}/cancel`}
                className="text-sm font-semibold text-red-600 hover:underline"
              >
                Cancel membership…
              </a>
            ) : null}
            {/* Archiving used to be a one-way door: the members list and the
                search both filter archived_at IS NULL, so the member was
                unreachable in the product afterwards. */}
            {user.permissions.has('members.edit') && member.archived_at ? (
              <form action={unarchiveAction}>
                <input type="hidden" name="memberId" value={id} />
                <Button variant="secondary">{tr.members.unarchive}</Button>
              </form>
            ) : null}
            {user.permissions.has('members.edit') && !member.archived_at && !currentMembership ? (
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-red-600">
                  Archive member…
                </summary>
                <form action={archiveAction} className="mt-2">
                  <input type="hidden" name="archive" value="1" />
                  <input type="hidden" name="memberId" value={id} />
                  <p className="mb-2 text-xs text-slate-500">
                    Keeps all history (nothing is deleted), ends member-app access and frees the
                    mobile number for a new member.
                  </p>
                  <Button variant="danger">Archive this member</Button>
                </form>
              </details>
            ) : null}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-base font-semibold">{tr.members.memberships}</h2>
          <Table
            headers={[
              tr.members.plan,
              tr.membership.startDate,
              tr.membership.endDate,
              tr.membership.total,
              tr.members.due,
              tr.members.status,
            ]}
          >
            {(memberships as Record<string, unknown>[]).map((m) => (
              <tr key={String(m.id)}>
                <td className="px-4 py-3">{String(m.plan_name_snapshot)}</td>
                <td className="px-4 py-3">{formatDisplayDate(String(m.start_date))}</td>
                <td className="px-4 py-3">{formatDisplayDate(String(m.end_date))}</td>
                <td className="px-4 py-3">{formatMoney(Number(m.total_amount))}</td>
                <td className="px-4 py-3">
                  {Number(m.due_amount ?? 0) > 0 ? (
                    <span className="font-semibold text-amber-700">
                      {formatMoney(Number(m.due_amount))}
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone(String(m.state))}>{String(m.state)}</Badge>
                </td>
              </tr>
            ))}
          </Table>
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold">{tr.members.paymentsTab}</h2>
          {payments.length === 0 ? (
            <p className="text-sm text-slate-500">No payments recorded.</p>
          ) : (
            <Table
              headers={[
                tr.payments.date,
                tr.payments.amount,
                tr.payments.method,
                tr.payments.receiptNumber,
              ]}
            >
              {(payments as Record<string, unknown>[]).map((p) => (
                <tr key={String(p.id)}>
                  <td className="px-4 py-3">{formatDisplayDate(String(p.payment_date))}</td>
                  <td className="px-4 py-3 font-medium">{formatMoney(Number(p.amount))}</td>
                  <td className="px-4 py-3">
                    {tr.payments.methods[p.method as keyof typeof tr.payments.methods] ??
                      String(p.method)}
                  </td>
                  <td className="px-4 py-3">
                    {p.receipt_number ? (
                      <Link
                        href={`/receipts/${String(p.id)}`}
                        className="text-primary hover:underline"
                      >
                        {String(p.receipt_number)}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </section>
      </div>

      {addons.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-3 text-base font-semibold">PT / Add-ons</h2>
          <Table
            headers={['Package', tr.members.trainer, 'Sessions', 'Validity', tr.members.status]}
          >
            {(addons as Record<string, unknown>[]).map((a) => (
              <tr key={String(a.id)}>
                <td className="px-4 py-3">{String(a.name_snapshot)}</td>
                <td className="px-4 py-3">{a.trainer_name ? String(a.trainer_name) : '—'}</td>
                <td className="px-4 py-3">
                  {a.sessions_total != null ? `${a.sessions_used}/${a.sessions_total}` : '∞'}
                </td>
                <td className="px-4 py-3">
                  {formatDisplayDate(String(a.start_date))} →{' '}
                  {formatDisplayDate(String(a.end_date))}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone(String(a.state))}>{String(a.state)}</Badge>
                </td>
                <td className="px-4 py-3">
                  {a.state === 'active' && a.sessions_total != null ? (
                    <form action={logPtAction}>
                      <input type="hidden" name="memberId" value={id} />
                      <input type="hidden" name="memberAddonId" value={String(a.id)} />
                      <button className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark">
                        Log session
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        </section>
      ) : null}

      <section className="mt-6">
        <h2 className="mb-3 text-base font-semibold">{tr.members.attendanceTab}</h2>
        {attendance.length === 0 ? (
          <p className="text-sm text-slate-500">No visits recorded.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(attendance as Record<string, unknown>[]).map((a) => (
              <Badge key={String(a.id)} tone="muted">
                {new Date(String(a.checked_in_at)).toLocaleString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: 'Asia/Kolkata',
                })}
              </Badge>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
