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
  const str = (name: string) => {
    const v = String(formData.get(name) ?? '').trim();
    return v === '' ? undefined : v;
  };
  const mobileRaw = str('mobile');
  if (mobileRaw && !isValidIndianMobile(mobileRaw)) {
    redirect(
      `/members/${memberId}/edit?error=${encodeURIComponent('Enter a valid 10-digit mobile number.')}`,
    );
  }
  const altRaw = str('altMobile');
  if (altRaw && !isValidIndianMobile(altRaw)) {
    redirect(
      `/members/${memberId}/edit?error=${encodeURIComponent('Alternate mobile is not valid.')}`,
    );
  }
  try {
    await updateMember(user, memberId, {
      branchId: str('branchId'),
      firstName: str('firstName'),
      lastName: str('lastName') ?? null,
      mobile: mobileRaw ? normalizeIndianMobile(mobileRaw).e164 : undefined,
      altMobile: altRaw ? normalizeIndianMobile(altRaw).e164 : undefined,
      email: str('email'),
      village: str('village'),
      district: str('district'),
      pinCode: str('pinCode'),
      emergencyContactName: str('emergencyContactName'),
      emergencyContactPhone: (() => {
        const v = str('emergencyContactPhone');
        return v && isValidIndianMobile(v)
          ? normalizeIndianMobile(v).e164
          : v
            ? undefined
            : undefined;
      })(),
      assignedTrainerId: formData.get('assignedTrainerId') === '' ? null : str('assignedTrainerId'),
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
          <Field label="Branch (transfer)" required>
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
          <Field label="Emergency phone">
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
