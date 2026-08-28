import { redirect } from 'next/navigation';
import { hasPermission } from '@gymflow/core';
import { requirePermission } from '@/lib/session';
import { getBrand, getSettings, updateBrand, updateSettings } from '@/lib/services/settings';
import { toUserMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  PageHeader,
  SuccessBanner,
  inputCls,
} from '@/components/ui';

export const dynamic = 'force-dynamic';

async function saveSettingsAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('settings.manage');
  // `|| undefined` on a number turns a deliberate 0 into "leave unchanged",
  // and on a string turns "clear this" into the same thing. Parse both
  // explicitly: missing field = leave alone, present-but-empty = clear.
  const num = (name: string): number | undefined => {
    const raw = formData.get(name);
    if (raw === null || String(raw).trim() === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  const text = (name: string): string | undefined => {
    const raw = formData.get(name);
    return raw === null ? undefined : String(raw).trim();
  };
  const clearable = (name: string): string | null | undefined => {
    const v = text(name);
    return v === undefined ? undefined : v === '' ? null : v;
  };

  const gstin = clearable('gstin')?.toUpperCase() ?? clearable('gstin');
  if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
    redirect(
      `/settings?error=${encodeURIComponent(
        'GSTIN must be 15 characters, e.g. 37ABCDE1234F1Z5. Leave it empty if the gym is not registered.',
      )}`,
    );
  }

  try {
    await updateSettings(user, {
      receipt_prefix: text('receiptPrefix')?.toUpperCase() || undefined,
      default_grace_period_days: num('gracePeriodDays'),
      max_freezes_per_year: num('maxFreezes'),
      max_freeze_days_per_year: num('maxFreezeDays'),
      allow_partial_payments: formData.get('allowPartial') === 'on',
      whatsapp_renewal_template_en: text('waTemplateEn') || undefined,
      whatsapp_renewal_template_te: text('waTemplateTe') || undefined,
      receipt_footer: clearable('receiptFooter'),
      gstin,
      tax_state_name: clearable('taxStateName'),
    });
  } catch (err) {
    redirect(`/settings?error=${encodeURIComponent(toUserMessage(err))}`);
  }
  redirect('/settings?msg=saved');
}

async function saveBrandAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('settings.manage');
  const str = (n: string) => String(formData.get(n) ?? '').trim() || undefined;
  const color = str('primaryColor');
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
    redirect(`/settings?error=${encodeURIComponent('Brand color must look like #16a34a')}`);
  }
  try {
    await updateBrand(user, {
      name: str('brandName'),
      primary_color: color,
      support_phone: str('supportPhone'),
      support_whatsapp: str('supportWhatsapp'),
      terms_url: str('termsUrl'),
      privacy_url: str('privacyUrl'),
    });
  } catch (err) {
    redirect(`/settings?error=${encodeURIComponent(toUserMessage(err))}`);
  }
  redirect('/settings?msg=saved');
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; msg?: string }>;
}) {
  const user = await requirePermission('settings.view');
  const { error, msg } = await searchParams;
  const tr = await t();
  const [settings, brand] = await Promise.all([getSettings(user), getBrand(user)]);
  const canManage =
    hasPermission(user.permissions, 'settings.manage') || user.kind === 'platform_admin';
  if (!settings) {
    return <PageHeader title={tr.nav.settings} subtitle="No settings found for this account." />;
  }

  return (
    <>
      <PageHeader title={tr.nav.settings} subtitle={settings.tenant_name} />
      <ErrorBanner message={error ?? null} />
      <SuccessBanner message={msg === 'saved' ? 'Settings saved.' : null} />

      <Card className="max-w-2xl">
        <form action={saveSettingsAction} className="space-y-4">
          <fieldset disabled={!canManage} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Receipt prefix" hint="e.g. SVF → SVF-2026-000123">
                <input
                  name="receiptPrefix"
                  defaultValue={settings.receipt_prefix}
                  pattern="[A-Za-z0-9]{1,8}"
                  className={inputCls}
                />
              </Field>
              <Field label="Default grace period (days)">
                <input
                  name="gracePeriodDays"
                  type="number"
                  min={0}
                  max={60}
                  defaultValue={settings.default_grace_period_days}
                  className={inputCls}
                />
              </Field>
              <Field label="Max freezes per year">
                <input
                  name="maxFreezes"
                  type="number"
                  min={0}
                  max={12}
                  defaultValue={settings.max_freezes_per_year}
                  className={inputCls}
                />
              </Field>
              <Field label="Max freeze days per year">
                <input
                  name="maxFreezeDays"
                  type="number"
                  min={0}
                  max={365}
                  defaultValue={settings.max_freeze_days_per_year}
                  className={inputCls}
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="allowPartial"
                defaultChecked={settings.allow_partial_payments}
                className="h-4 w-4"
              />
              Allow partial payments
            </label>
            <Field
              label="WhatsApp renewal template (English)"
              hint="Placeholders: {{member_first_name}}, {{gym_name}}, {{expiry_date}}"
            >
              <textarea
                name="waTemplateEn"
                rows={3}
                defaultValue={settings.whatsapp_renewal_template_en}
                className={inputCls}
              />
            </Field>
            <Field label="WhatsApp renewal template (Telugu)">
              <textarea
                name="waTemplateTe"
                rows={3}
                defaultValue={settings.whatsapp_renewal_template_te}
                className={inputCls}
              />
            </Field>
            <Field label="Receipt footer">
              <input
                name="receiptFooter"
                defaultValue={settings.receipt_footer ?? ''}
                className={inputCls}
              />
            </Field>
            {/* Setting a GSTIN turns every receipt into a GST tax invoice
                (taxable value + CGST/SGST split + SAC). A gym below the
                turnover threshold must leave it empty and keeps the plain
                payment acknowledgement. */}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="GSTIN"
                hint="15 characters, e.g. 37ABCDE1234F1Z5. Empty = not registered, plain receipts."
              >
                <input
                  name="gstin"
                  defaultValue={settings.gstin ?? ''}
                  maxLength={15}
                  placeholder="37ABCDE1234F1Z5"
                  className={`${inputCls} font-mono uppercase`}
                />
              </Field>
              <Field label="State (place of supply)" hint="Printed on the tax invoice">
                <input
                  name="taxStateName"
                  defaultValue={settings.tax_state_name ?? ''}
                  placeholder="Andhra Pradesh"
                  className={inputCls}
                />
              </Field>
            </div>
            {canManage ? <Button>{tr.common.save}</Button> : null}
          </fieldset>
        </form>
      </Card>

      {brand ? (
        <Card className="mt-6 max-w-2xl">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Brand & member app identity</h2>
          <form action={saveBrandAction} className="space-y-4">
            <fieldset disabled={!canManage} className="grid gap-4 sm:grid-cols-2">
              <Field label="Brand name" hint="Shown in the member app">
                <input name="brandName" defaultValue={brand.name} className={inputCls} />
              </Field>
              <Field label="Primary color" hint="#16a34a">
                <input
                  name="primaryColor"
                  defaultValue={brand.primary_color ?? ''}
                  className={inputCls}
                />
              </Field>
              <Field label="Support phone">
                <input
                  name="supportPhone"
                  defaultValue={brand.support_phone ?? ''}
                  className={inputCls}
                />
              </Field>
              <Field label="Support WhatsApp">
                <input
                  name="supportWhatsapp"
                  defaultValue={brand.support_whatsapp ?? ''}
                  className={inputCls}
                />
              </Field>
              <Field label="Terms URL">
                <input
                  name="termsUrl"
                  type="url"
                  defaultValue={brand.terms_url ?? ''}
                  className={inputCls}
                />
              </Field>
              <Field label="Privacy URL">
                <input
                  name="privacyUrl"
                  type="url"
                  defaultValue={brand.privacy_url ?? ''}
                  className={inputCls}
                />
              </Field>
              {canManage ? (
                <div className="sm:col-span-2">
                  <Button>{tr.common.save}</Button>
                </div>
              ) : null}
            </fieldset>
          </form>
        </Card>
      ) : null}
    </>
  );
}
