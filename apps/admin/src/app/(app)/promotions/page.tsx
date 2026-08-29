import { redirect } from 'next/navigation';
import { formatDisplayDate, formatMoney, parseMoney } from '@gymflow/utils';
import { hasPermission } from '@gymflow/core';
import { requirePermission } from '@/lib/session';
import { asPrincipal } from '@/lib/db';
import { writeAudit } from '@/lib/audit';
import { toUserMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Field,
  PageHeader,
  Table,
  inputCls,
} from '@/components/ui';

export const dynamic = 'force-dynamic';

async function createPromotionAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('promotions.manage');
  const kind = String(formData.get('discountKind'));
  let value = 0;
  try {
    value =
      kind === 'percentage'
        ? Math.round(Number(formData.get('percent')) * 100) // % → bps
        : kind === 'flat'
          ? parseMoney(String(formData.get('flat') ?? '0'))
          : 0;
  } catch {
    redirect(`/promotions?error=${encodeURIComponent('Enter a valid discount value.')}`);
  }
  try {
    await asPrincipal(user.claims, async (tx) => {
      const r = await tx.query(
        `INSERT INTO promotions (tenant_id, code, name, discount_kind, discount_value,
                                 valid_from, valid_to, audience)
         VALUES ($1, upper($2), $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          user.tenantId,
          String(formData.get('code')),
          String(formData.get('name')),
          kind,
          value,
          String(formData.get('validFrom')),
          String(formData.get('validTo')),
          String(formData.get('audience') ?? 'all'),
        ],
      );
      await writeAudit(tx, user, {
        action: 'promotion.create',
        entityType: 'promotion',
        entityId: (r.rows[0] as { id: string }).id,
        after: { code: String(formData.get('code')), kind, value },
      });
    });
  } catch (err) {
    redirect(`/promotions?error=${encodeURIComponent(toUserMessage(err))}`);
  }
  redirect('/promotions');
}

async function togglePromotionAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('promotions.manage');
  await asPrincipal(user.claims, (tx) =>
    tx.query(`UPDATE promotions SET is_active = $2 WHERE id = $1`, [
      String(formData.get('id')),
      formData.get('active') === '1',
    ]),
  );
  redirect('/promotions');
}

export default async function PromotionsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requirePermission('promotions.view');
  const { error } = await searchParams;
  const tr = await t();
  const canManage =
    hasPermission(user.permissions, 'promotions.manage') || user.kind === 'platform_admin';

  const promos = await asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(
      `SELECT p.id, p.code, p.name, p.discount_kind, p.discount_value::bigint AS discount_value,
              p.valid_from::text AS valid_from, p.valid_to::text AS valid_to, p.audience, p.is_active,
              (SELECT count(*)::int FROM promotion_redemptions pr WHERE pr.promotion_id = p.id) AS uses,
              (SELECT coalesce(sum(pr.discount_amount),0)::bigint FROM promotion_redemptions pr WHERE pr.promotion_id = p.id) AS total_discount
       FROM promotions p ORDER BY p.created_at DESC`,
    );
    return r.rows as Record<string, unknown>[];
  });

  return (
    <>
      <PageHeader title={tr.nav.promotions} />
      <ErrorBanner message={error ?? null} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Table
            headers={[
              'Code',
              tr.members.name,
              tr.membership.discount,
              'Validity',
              'Uses',
              tr.members.status,
              '',
            ]}
          >
            {promos.map((p) => (
              <tr key={String(p.id)}>
                <td className="px-4 py-3 font-mono font-semibold">{String(p.code)}</td>
                <td className="px-4 py-3">{String(p.name)}</td>
                <td className="px-4 py-3">
                  {p.discount_kind === 'percentage'
                    ? `${Number(p.discount_value) / 100}%`
                    : p.discount_kind === 'flat'
                      ? formatMoney(Number(p.discount_value))
                      : 'Joining fee waiver'}
                  <span className="block text-xs text-slate-400">
                    saved {formatMoney(Number(p.total_discount))}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs">
                  {formatDisplayDate(String(p.valid_from))} –{' '}
                  {formatDisplayDate(String(p.valid_to))}
                </td>
                <td className="px-4 py-3">{Number(p.uses)}</td>
                <td className="px-4 py-3">
                  <Badge tone={p.is_active ? 'success' : 'muted'}>
                    {p.is_active ? 'Active' : 'Off'}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  {canManage ? (
                    <form action={togglePromotionAction}>
                      <input type="hidden" name="id" value={String(p.id)} />
                      <input type="hidden" name="active" value={p.is_active ? '0' : '1'} />
                      <button className="text-xs font-semibold text-slate-500 hover:text-slate-700">
                        {p.is_active ? 'Disable' : 'Enable'}
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        </div>

        {canManage ? (
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-slate-700">New promotion</h2>
            <form action={createPromotionAction} className="space-y-3">
              <Field label={tr.ui.code} required>
                <input
                  name="code"
                  required
                  placeholder={tr.ui.sankranti27}
                  pattern="[A-Za-z0-9-]{2,40}"
                  className={inputCls}
                />
              </Field>
              <Field label={tr.members.name} required>
                <input name="name" required className={inputCls} />
              </Field>
              <Field label={tr.ui.type} required>
                <select name="discountKind" className={inputCls} defaultValue="percentage">
                  <option value="percentage">Percentage</option>
                  <option value="flat">Flat ₹</option>
                  <option value="joining_fee_waiver">Joining fee waiver</option>
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={tr.ui.percent}>
                  <input
                    name="percent"
                    type="number"
                    min={0}
                    max={100}
                    step="0.5"
                    placeholder="10"
                    className={inputCls}
                  />
                </Field>
                <Field label={tr.ui.flat}>
                  <input name="flat" inputMode="decimal" placeholder="500" className={inputCls} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={tr.ui.from} required>
                  <input name="validFrom" type="date" required className={inputCls} />
                </Field>
                <Field label="To" required>
                  <input name="validTo" type="date" required className={inputCls} />
                </Field>
              </div>
              <Field label={tr.ui.audience}>
                <select name="audience" className={inputCls} defaultValue="all">
                  <option value="all">Everyone</option>
                  <option value="new_members">New members only</option>
                  <option value="renewals">Renewals only</option>
                  <option value="win_back">Win-back (lapsed members)</option>
                </select>
              </Field>
              <Button className="w-full">{tr.common.save}</Button>
            </form>
          </Card>
        ) : null}
      </div>
    </>
  );
}
