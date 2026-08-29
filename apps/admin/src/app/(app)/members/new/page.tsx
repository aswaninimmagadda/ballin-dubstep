import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
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
  const jar = await cookies();
  jar.set(STEP_COOKIE, mobile, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/members/new',
    maxAge: 900,
  });
  if (dups.length > 0) redirect(`/members/new?dup=${dups[0]!.id}`);
  redirect('/members/new?step=2');
}

/** Field labels for validation messages, so the error names what to fix. */
const FIELD_LABELS: Record<string, string> = {
  branchId: 'Branch',
  firstName: 'First name',
  lastName: 'Last name',
  mobile: 'Mobile number',
  altMobile: 'Alternate mobile',
  email: 'Email',
  dateOfBirth: 'Date of birth',
  pinCode: 'PIN code',
  emergencyContactPhone: 'Emergency contact number',
  emergencyContactName: 'Emergency contact name',
};

/**
 * Onboarding is a twelve-field form; losing it to a validation slip means
 * typing everything again with a member waiting at the desk. The entry is
 * parked in a short-lived, http-only cookie (never the URL — these are the
 * member's personal details) and restored into the form.
 */
const DRAFT_COOKIE = 'gymflow_member_draft';

/**
 * The number step 1 checked for duplicates, carried to step 2.
 *
 * It used to travel in the query string — `?mobile=%2B919876543210` — which
 * puts a member's phone number in the server access log, the browser history
 * and the Referer of anything the page loads. The product's own rule is that
 * member data does not go in URLs, and this was the main onboarding path.
 *
 * Separate from DRAFT_COOKIE on purpose: starting a new member overwrites this
 * one, which is what stops an abandoned draft being replayed into the next
 * person's form.
 */
const STEP_COOKIE = 'gymflow_member_step_mobile';

async function createMemberAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('members.create');
  const raw = Object.fromEntries(
    [...formData.entries()].filter(([, v]) => typeof v === 'string' && v !== ''),
  ) as Record<string, string>;
  const keepDraft = async () => {
    const jar = await cookies();
    jar.set(DRAFT_COOKIE, JSON.stringify(raw), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/members/new',
      maxAge: 600,
    });
  };
  const parsed = createMemberSchema.safeParse({ ...raw, tags: [] });
  if (!parsed.success) {
    await keepDraft();
    const issue = parsed.error.issues[0];
    const label = FIELD_LABELS[String(issue?.path?.[0] ?? '')] ?? 'One of the fields';
    redirect(
      `/members/new?step=2&error=${encodeURIComponent(`${label}: ${issue?.message ?? 'please check this field'}`)}`,
    );
  }
  let id: string;
  try {
    const result = await createMember(user, parsed.data);
    id = result.id;
    const leadId = raw.leadId;
    if (leadId) await markLeadConverted(user, leadId, id);
  } catch (err) {
    await keepDraft();
    redirect(`/members/new?step=2&error=${encodeURIComponent(toUserMessage(err))}`);
  }
  const doneJar = await cookies();
  doneJar.delete({ name: DRAFT_COOKIE, path: '/members/new' });
  doneJar.delete({ name: STEP_COOKIE, path: '/members/new' });
  redirect(`/members/${id!}/sell?new=1`);
}

export default async function NewMemberPage({
  searchParams,
}: {
  searchParams: Promise<{
    step?: string;
    dup?: string;
    error?: string;
    lead?: string;
  }>;
}) {
  const user = await requirePermission('members.create');
  const { step, dup, error, lead } = await searchParams;
  const mobile = (await cookies()).get(STEP_COOKIE)?.value;
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

  // Restore whatever was typed before a validation slip (see DRAFT_COOKIE) —
  // but ONLY for the member it was typed for.
  //
  // The draft used to be applied to whoever came next: abandon a form after a
  // validation error, start the next walk-in, and their form arrived carrying
  // the previous person's mobile number, emergency contact and notes. Worse,
  // the cookie's mobile won over the one step 1 had just checked for
  // duplicates, so the member could be created under the wrong number
  // entirely. Binding the draft to its mobile makes it useful for the person
  // it belongs to and inert for everyone else.
  let draft: Record<string, string> = {};
  const draftRaw = (await cookies()).get(DRAFT_COOKIE)?.value;
  if (draftRaw) {
    try {
      const parsedDraft = JSON.parse(draftRaw) as Record<string, string>;
      const intendedMobile = mobile ?? leadData?.mobile;
      if (!intendedMobile || parsedDraft.mobile === intendedMobile) {
        draft = parsedDraft;
      }
    } catch {
      draft = {};
    }
  }
  const prev = (name: string) => draft[name] ?? undefined;

  // A duplicate mobile cannot be created — the unique index refuses it — so
  // don't invite the receptionist to fill the form and lose the entry.
  const showForm = (step === '2' || leadData) && !dupInfo;
  // Step 1's duplicate check ran against this number, so it is authoritative.
  const effectiveMobile = mobile ?? leadData?.mobile ?? draft.mobile ?? '';

  return (
    <>
      <PageHeader title={tr.members.newMember} />
      <ErrorBanner
        message={
          error === 'badmobile' ? 'Enter a valid 10-digit Indian mobile number.' : error || null
        }
      />

      {dupInfo ? (
        <Card className="mb-4 border-amber-300 bg-amber-50">
          <p className="text-sm font-medium text-amber-800">{tr.members.duplicateWarning}</p>
          <p className="mt-1 text-sm text-amber-900">
            {dupInfo.first_name} {dupInfo.last_name ?? ''} · {dupInfo.membership_number}
          </p>
          <p className="mt-2 text-xs text-amber-800">
            This number is already registered, so it cannot be used twice. Open the existing member,
            or go back and enter a different number.
          </p>
          <div className="mt-3 flex gap-2">
            <Button href={`/members/${dupInfo.id}`}>{tr.members.useExisting}</Button>
            <Button href="/members/new" variant="secondary">
              Use a different number
            </Button>
          </div>
        </Card>
      ) : null}

      {!showForm ? (
        <Card className="max-w-md">
          <form action={checkMobileAction} className="space-y-4">
            <Field label={tr.members.mobile} required hint={tr.ui.weCheckForExistingMembers}>
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
            <Field label={tr.ui.branch} required>
              <select name="branchId" required defaultValue={prev('branchId')} className={inputCls}>
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
                defaultValue={prev('firstName') ?? leadData?.name?.split(' ')[0] ?? ''}
              />
            </Field>
            <Field label={tr.members.lastName}>
              <input
                name="lastName"
                className={inputCls}
                defaultValue={
                  prev('lastName') ?? leadData?.name?.split(' ').slice(1).join(' ') ?? ''
                }
              />
            </Field>
            <Field label={tr.ui.gender}>
              <select name="gender" className={inputCls} defaultValue={prev('gender') ?? ''}>
                <option value="">—</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
                <option value="undisclosed">Prefer not to say</option>
              </select>
            </Field>
            <Field label={tr.ui.dateOfBirth}>
              <input
                name="dateOfBirth"
                defaultValue={prev('dateOfBirth')}
                type="date"
                className={inputCls}
              />
            </Field>
            <Field label={tr.members.village}>
              <input name="village" defaultValue={prev('village')} className={inputCls} />
            </Field>
            <Field label={tr.members.pinCode}>
              <input
                name="pinCode"
                defaultValue={prev('pinCode')}
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
            <Field label={tr.ui.referralSource}>
              <select
                name="referralSource"
                className={inputCls}
                defaultValue={prev('referralSource') ?? 'walk_in'}
              >
                <option value="walk_in">Walk-in</option>
                <option value="referral">Referral</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="social">Social media</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label={`${tr.members.emergencyContact} (${tr.common.optional})`}>
              <input
                name="emergencyContactName"
                defaultValue={prev('emergencyContactName')}
                placeholder={tr.ui.name}
                className={inputCls}
              />
            </Field>
            <Field label={tr.ui.emergencyPhone}>
              <input
                name="emergencyContactPhone"
                defaultValue={prev('emergencyContactPhone')}
                type="tel"
                className={inputCls}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label={tr.members.notes}>
                <textarea name="notes" rows={2} defaultValue={prev('notes')} className={inputCls} />
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
