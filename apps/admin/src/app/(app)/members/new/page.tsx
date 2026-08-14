import { redirect } from 'next/navigation';
import { createMemberSchema } from '@gymflow/validation';
import { normalizeIndianMobile, isValidIndianMobile } from '@gymflow/utils';
import { requirePermission } from '@/lib/session';
import { createMember, findDuplicates } from '@/lib/services/members';
import { markLeadConverted } from '@/lib/services/leads';
import { asPrincipal } from '@/lib/db';
import { toUserMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { Button, Card, ErrorBanner, Field, PageHeader, inputCls } from '@/components/ui';

export const dynamic = 'force-dynamic';

/**
 * Guided onboarding, mobile-first:
 * Step 1 — mobile number (duplicate check happens on submit)
 * Step 2 — details form, prefilled with the mobile (and lead data if converting)
 * After creation → straight to "sell membership" for that member.
 */

async function checkMobileAction(formData: FormData): Promise<void> {
  'use server';
  const raw = String(formData.get('mobile') ?? '');
  if (!isValidIndianMobile(raw)) redirect('/members/new?error=badmobile');
  const mobile = normalizeIndianMobile(raw).e164;
  const user = await requirePermission('members.create');
  const dups = await findDuplicates(user, mobile);
  if (dups.length > 0)
    redirect(`/members/new?mobile=${encodeURIComponent(mobile)}&dup=${dups[0]!.id}`);
  redirect(`/members/new?mobile=${encodeURIComponent(mobile)}&step=2`);
}

async function createMemberAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('members.create');
  const raw = Object.fromEntries(
    [...formData.entries()].filter(([, v]) => typeof v === 'string' && v !== ''),
  ) as Record<string, string>;
  const parsed = createMemberSchema.safeParse({ ...raw, tags: [] });
  if (!parsed.success) {
    redirect(`/members/new?step=2&mobile=${encodeURIComponent(raw.mobile ?? '')}&error=validation`);
  }
  let id: string;
  try {
    const result = await createMember(user, parsed.data);
    id = result.id;
    const leadId = raw.leadId;
    if (leadId) await markLeadConverted(user, leadId, id);
  } catch (err) {
    redirect(
      `/members/new?step=2&mobile=${encodeURIComponent(raw.mobile ?? '')}&error=${encodeURIComponent(toUserMessage(err))}`,
    );
  }
  redirect(`/members/${id!}/sell?new=1`);
}

export default async function NewMemberPage({
  searchParams,
}: {
  searchParams: Promise<{
    mobile?: string;
    step?: string;
    dup?: string;
    error?: string;
    lead?: string;
  }>;
}) {
  const user = await requirePermission('members.create');
  const { mobile, step, dup, error, lead } = await searchParams;
  const tr = await t();

  const branches = await asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(`SELECT id, name FROM branches WHERE is_active ORDER BY name`);
    return r.rows as { id: string; name: string }[];
  });
  const trainers = await asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(`SELECT id, name FROM trainers WHERE is_active ORDER BY name`);
    return r.rows as { id: string; name: string }[];
  });
  let leadData: { id: string; name: string; mobile: string } | null = null;
  if (lead) {
    leadData = await asPrincipal(user.claims, async (tx) => {
      const r = await tx.query(`SELECT id, name, mobile FROM leads WHERE id = $1`, [lead]);
      return (r.rows[0] as { id: string; name: string; mobile: string } | undefined) ?? null;
    });
  }

  let dupInfo: {
    id: string;
    first_name: string;
    last_name: string | null;
    membership_number: string;
  } | null = null;
  if (dup) {
    const dups = await findDuplicates(user, mobile ?? '');
    dupInfo = dups.find((d) => d.id === dup) ?? null;
  }

  const showForm = step === '2' || dup || leadData;
  const effectiveMobile = leadData?.mobile ?? mobile ?? '';

  return (
    <>
      <PageHeader title={tr.members.newMember} />
      <ErrorBanner
        message={
          error === 'badmobile'
            ? 'Enter a valid 10-digit Indian mobile number.'
            : error === 'validation'
              ? 'Please check the highlighted fields and try again.'
              : error || null
        }
      />

      {dupInfo ? (
        <Card className="mb-4 border-amber-300 bg-amber-50">
          <p className="text-sm font-medium text-amber-800">{tr.members.duplicateWarning}</p>
          <p className="mt-1 text-sm text-amber-900">
            {dupInfo.first_name} {dupInfo.last_name ?? ''} · {dupInfo.membership_number}
          </p>
          <div className="mt-3 flex gap-2">
            <Button href={`/members/${dupInfo.id}`} variant="secondary">
              {tr.members.useExisting}
            </Button>
          </div>
        </Card>
      ) : null}

      {!showForm ? (
        <Card className="max-w-md">
          <form action={checkMobileAction} className="space-y-4">
            <Field label={tr.members.mobile} required hint="We check for existing members first.">
              <input
                name="mobile"
                type="tel"
                inputMode="numeric"
                autoFocus
                required
                placeholder="98765 43210"
                className={inputCls}
              />
            </Field>
            <Button className="w-full">{tr.common.next}</Button>
          </form>
        </Card>
      ) : (
        <Card className="max-w-2xl">
          <form action={createMemberAction} className="grid gap-4 sm:grid-cols-2">
            {leadData ? <input type="hidden" name="leadId" value={leadData.id} /> : null}
            <Field label={tr.members.mobile} required>
              <input name="mobile" defaultValue={effectiveMobile} required className={inputCls} />
            </Field>
            <Field label="Branch" required>
              <select name="branchId" required className={inputCls}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={tr.members.firstName} required>
              <input
                name="firstName"
                required
                autoFocus
                className={inputCls}
                defaultValue={leadData?.name?.split(' ')[0] ?? ''}
              />
            </Field>
            <Field label={tr.members.lastName}>
              <input
                name="lastName"
                className={inputCls}
                defaultValue={leadData?.name?.split(' ').slice(1).join(' ') ?? ''}
              />
            </Field>
            <Field label="Gender">
              <select name="gender" className={inputCls} defaultValue="">
                <option value="">—</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
                <option value="undisclosed">Prefer not to say</option>
              </select>
            </Field>
            <Field label="Date of birth">
              <input name="dateOfBirth" type="date" className={inputCls} />
            </Field>
            <Field label={tr.members.village}>
              <input name="village" className={inputCls} />
            </Field>
            <Field label={tr.members.pinCode}>
              <input
                name="pinCode"
                inputMode="numeric"
                pattern="[1-9][0-9]{5}"
                className={inputCls}
              />
            </Field>
            <Field label={tr.members.trainer}>
              <select name="assignedTrainerId" className={inputCls} defaultValue="">
                <option value="">—</option>
                {trainers.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Referral source">
              <select name="referralSource" className={inputCls} defaultValue="walk_in">
                <option value="walk_in">Walk-in</option>
                <option value="referral">Referral</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="social">Social media</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label={`${tr.members.emergencyContact} (${tr.common.optional})`}>
              <input name="emergencyContactName" placeholder="Name" className={inputCls} />
            </Field>
            <Field label="Emergency phone">
              <input name="emergencyContactPhone" type="tel" className={inputCls} />
            </Field>
            <div className="sm:col-span-2">
              <Field label={tr.members.notes}>
                <textarea name="notes" rows={2} className={inputCls} />
              </Field>
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <Button>
                {tr.common.next} → {tr.membership.sell}
              </Button>
              <Button href="/members" variant="secondary" type="button">
                {tr.common.cancel}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </>
  );
}
