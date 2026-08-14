import { notFound, redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { formatMoney, parseMoney } from '@gymflow/utils';
import { requirePermission } from '@/lib/session';
import { getMemberDetail } from '@/lib/services/members';
import { listAddonPackages, sellAddon } from '@/lib/services/addons';
import { asPrincipal } from '@/lib/db';
import { toUserMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { Button, Card, ErrorBanner, Field, PageHeader, inputCls } from '@/components/ui';

export const dynamic = 'force-dynamic';

async function sellAddonAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('pt.manage');
  const memberId = String(formData.get('memberId'));
  const amountRaw = String(formData.get('amount') ?? '').trim();
  try {
    await sellAddon(user, {
      memberId,
      addonPackageId: String(formData.get('addonPackageId')),
      trainerId: String(formData.get('trainerId') ?? '') || null,
      idempotencyKey: String(formData.get('idempotencyKey')),
      payment: amountRaw
        ? {
            amount: parseMoney(amountRaw),
            method: String(formData.get('method') ?? 'cash'),
            externalReference: String(formData.get('externalReference') ?? '').trim() || null,
          }
        : null,
    });
  } catch (err) {
    redirect(`/members/${memberId}/addon?error=${encodeURIComponent(toUserMessage(err))}`);
  }
  redirect(`/members/${memberId}?msg=addon`);
}

export default async function AddonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requirePermission('pt.manage');
  const { id } = await params;
  const { error } = await searchParams;
  const [detail, packages, tr] = await Promise.all([
    getMemberDetail(user, id),
    listAddonPackages(user),
    t(),
  ]);
  if (!detail) notFound();
  const trainers = await asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(`SELECT id, name FROM trainers WHERE is_active ORDER BY name`);
    return r.rows as { id: string; name: string }[];
  });

  return (
    <>
      <PageHeader
        title={`PT / Add-on — ${detail.member.first_name} ${detail.member.last_name ?? ''}`}
      />
      <ErrorBanner message={error ?? null} />
      <Card className="max-w-2xl">
        <form action={sellAddonAction} className="space-y-4">
          <input type="hidden" name="memberId" value={id} />
          <input type="hidden" name="idempotencyKey" value={randomUUID()} />

          <Field label="Package" required>
            <div className="space-y-2">
              {packages.map((p, i) => (
                <label
                  key={p.id}
                  className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 px-4 py-3 hover:border-primary has-checked:border-primary has-checked:bg-green-50"
                >
                  <span className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="addonPackageId"
                      value={p.id}
                      required
                      defaultChecked={i === 0}
                      className="h-4 w-4"
                    />
                    <span>
                      <span className="block text-sm font-semibold">{p.name}</span>
                      <span className="block text-xs text-slate-500">
                        {p.session_count != null ? `${p.session_count} sessions · ` : ''}
                        {p.validity_days} days validity
                      </span>
                    </span>
                  </span>
                  <span className="text-sm font-bold">{formatMoney(Number(p.price))}</span>
                </label>
              ))}
            </div>
          </Field>

          <Field label={tr.members.trainer}>
            <select name="trainerId" className={inputCls} defaultValue="">
              <option value="">—</option>
              {trainers.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>

          <fieldset className="rounded-lg border border-slate-200 p-4">
            <legend className="px-1 text-sm font-semibold text-slate-700">
              {tr.members.recordPayment}
            </legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={`${tr.payments.amount} (₹)`} hint="Leave empty to collect later">
                <input name="amount" inputMode="decimal" className={inputCls} />
              </Field>
              <Field label={tr.payments.method}>
                <select name="method" className={inputCls} defaultValue="cash">
                  {Object.entries(tr.payments.methods).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={tr.payments.reference}>
                <input name="externalReference" className={inputCls} />
              </Field>
            </div>
          </fieldset>

          <div className="flex gap-2">
            <Button>{tr.common.confirm}</Button>
            <Button href={`/members/${id}`} variant="secondary" type="button">
              {tr.common.cancel}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
