import { notFound, redirect } from 'next/navigation';
import { isValidIndianMobile, normalizeIndianMobile } from '@gymflow/utils';
import { requirePermission } from '@/lib/session';
import { getMemberDetail, updateMember } from '@/lib/services/members';
import { asPrincipal } from '@/lib/db';
import { toUserMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { Button, Card, ErrorBanner, Field, PageHeader, inputCls } from '@/components/ui';

export const dynamic = 'force-dynamic';

async function updateAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('members.edit');
  const memberId = String(formData.get('memberId'));
  // A field left blank means "clear this", not "ignore this" — every field on
  // the form is submitted, so blank is a deliberate erasure by the person at
  // the desk. Only `mobile` is mandatory (it is the member's login identity).
  const str = (name: string): string | null => {
    const v = String(formData.get(name) ?? '').trim();
    return v === '' ? null : v;
  };
  const fail = (message: string): never =>
    redirect(`/members/${memberId}/edit?error=${encodeURIComponent(message)}`);

  const mobileRaw = str('mobile');
  if (!mobileRaw || !isValidIndianMobile(mobileRaw)) {
    fail('Enter a valid 10-digit mobile number.');
  }
  const altRaw = str('altMobile');
  if (altRaw && !isValidIndianMobile(altRaw)) {
    fail('Alternate mobile is not valid. Leave it blank to remove it.');
  }
  const firstName = str('firstName');
  if (!firstName) fail('First name is required.');
  // Emergency contacts are often a landline or another household's number, so
  // accept any plausible phone — but say so when it is not, instead of
  // dropping it silently.
  const emergency = str('emergencyContactPhone');
  if (emergency && !/^[+\d][\d\s-]{5,19}$/.test(emergency)) {
    fail('Emergency contact number looks wrong. Use digits, spaces or dashes.');
  }
  try {
    await updateMember(user, memberId, {
      branchId: str('branchId') ?? undefined, // a member always has a branch
      firstName: firstName ?? undefined,
      lastName: str('lastName'),
      mobile: normalizeIndianMobile(mobileRaw!).e164,
      altMobile: altRaw ? normalizeIndianMobile(altRaw).e164 : null,
      email: str('email'),
      village: str('village'),
      district: str('district'),
      pinCode: str('pinCode'),
      emergencyContactName: str('emergencyContactName'),
      emergencyContactPhone: emergency,
      assignedTrainerId: str('assignedTrainerId'),
      notes: str('notes'),
    });
  } catch (err) {
    redirect(`/members/${memberId}/edit?error=${encodeURIComponent(toUserMessage(err))}`);
  }
  redirect(`/members/${memberId}?msg=edited`);
}

export default async function EditMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requirePermission('members.edit');
  const { id } = await params;
  const { error } = await searchParams;
  const [detail, tr] = await Promise.all([getMemberDetail(user, id), t()]);
  if (!detail) notFound();
  const m = detail.member;

  const [branches, trainers] = await asPrincipal(user.claims, async (tx) => {
    const b = await tx.query(`SELECT id, name FROM branches WHERE is_active ORDER BY name`);
    const x = await tx.query(`SELECT id, name FROM trainers WHERE is_active ORDER BY name`);
    return [b.rows, x.rows] as [{ id: string; name: string }[], { id: string; name: string }[]];
  });

  return (
    <>
      <PageHeader
        title={`${tr.members.name}: ${m.first_name} ${m.last_name ?? ''}`}
        subtitle={`${tr.members.memberNumber} ${m.membership_number}`}
      />
      <ErrorBanner message={error ?? null} />
      <Card className="max-w-2xl">
        <form action={updateAction} className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="memberId" value={id} />
          <Field label={tr.members.firstName} required>
            <input
              name="firstName"
              defaultValue={String(m.first_name)}
              required
              className={inputCls}
            />
          </Field>
          <Field label={tr.members.lastName}>
            <input
              name="lastName"
              defaultValue={m.last_name ? String(m.last_name) : ''}
              className={inputCls}
            />
          </Field>
          <Field label={tr.members.mobile} required>
            <input
              name="mobile"
              defaultValue={String(m.mobile).replace('+91', '')}
              required
              className={inputCls}
            />
          </Field>
          <Field label={tr.members.altMobile}>
            <input
              name="altMobile"
              defaultValue={m.alt_mobile ? String(m.alt_mobile).replace('+91', '') : ''}
              className={inputCls}
            />
          </Field>
          <Field label={tr.ui.branchTransfer} required>
            <select name="branchId" defaultValue={String(m.branch_id)} className={inputCls}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tr.members.trainer}>
            <select
              name="assignedTrainerId"
              defaultValue={m.assigned_trainer_id ? String(m.assigned_trainer_id) : ''}
              className={inputCls}
            >
              <option value="">—</option>
              {trainers.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tr.members.email}>
            <input
              name="email"
              type="email"
              defaultValue={m.email ? String(m.email) : ''}
              className={inputCls}
            />
          </Field>
          <Field label={tr.members.village}>
            <input
              name="village"
              defaultValue={m.village ? String(m.village) : ''}
              className={inputCls}
            />
          </Field>
          <Field label={tr.members.district}>
            <input
              name="district"
              defaultValue={m.district ? String(m.district) : ''}
              className={inputCls}
            />
          </Field>
          <Field label={tr.members.pinCode}>
            <input
              name="pinCode"
              defaultValue={m.pin_code ? String(m.pin_code) : ''}
              pattern="[1-9][0-9]{5}"
              className={inputCls}
            />
          </Field>
          <Field label={tr.members.emergencyContact}>
            <input
              name="emergencyContactName"
              defaultValue={m.emergency_contact_name ? String(m.emergency_contact_name) : ''}
              className={inputCls}
            />
          </Field>
          <Field label={tr.ui.emergencyPhone}>
            <input
              name="emergencyContactPhone"
              defaultValue={
                m.emergency_contact_phone
                  ? String(m.emergency_contact_phone).replace('+91', '')
                  : ''
              }
              className={inputCls}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label={tr.members.notes}>
              <textarea
                name="notes"
                rows={2}
                defaultValue={m.notes ? String(m.notes) : ''}
                className={inputCls}
              />
            </Field>
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button>{tr.common.save}</Button>
            <Button href={`/members/${id}`} variant="secondary" type="button">
              {tr.common.cancel}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
