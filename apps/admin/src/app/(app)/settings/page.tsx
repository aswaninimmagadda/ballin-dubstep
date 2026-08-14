import { redirect } from 'next/navigation';
import { hasPermission } from '@gymflow/core';
import { requirePermission } from '@/lib/session';
import { getSettings, updateSettings } from '@/lib/services/settings';
import { toUserMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { Button, Card, ErrorBanner, Field, PageHeader, SuccessBanner, inputCls } from '@/components/ui';

export const dynamic = 'force-dynamic';

async function saveSettingsAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('settings.manage');
  try {
    await updateSettings(user, {
      receipt_prefix: String(formData.get('receiptPrefix') ?? '').toUpperCase() || undefined,
      default_grace_period_days: Number(formData.get('gracePeriodDays')) || undefined,
      max_freezes_per_year: Number(formData.get('maxFreezes')) || undefined,
      max_freeze_days_per_year: Number(formData.get('maxFreezeDays')) || undefined,
      allow_partial_payments: formData.get('allowPartial') === 'on',
      whatsapp_renewal_template_en: String(formData.get('waTemplateEn') ?? '') || undefined,
      whatsapp_renewal_template_te: String(formData.get('waTemplateTe') ?? '') || undefined,
      receipt_footer: String(formData.get('receiptFooter') ?? '') || undefined,
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
  const settings = await getSettings(user);
  const canManage = hasPermission(user.permissions, 'settings.manage') || user.kind === 'platform_admin';
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
                <input name="receiptPrefix" defaultValue={settings.receipt_prefix}
                  pattern="[A-Za-z0-9]{1,8}" className={inputCls} />
              </Field>
              <Field label="Default grace period (days)">
                <input name="gracePeriodDays" type="number" min={0} max={60}
                  defaultValue={settings.default_grace_period_days} className={inputCls} />
              </Field>
              <Field label="Max freezes per year">
                <input name="maxFreezes" type="number" min={0} max={12}
                  defaultValue={settings.max_freezes_per_year} className={inputCls} />
              </Field>
              <Field label="Max freeze days per year">
                <input name="maxFreezeDays" type="number" min={0} max={365}
                  defaultValue={settings.max_freeze_days_per_year} className={inputCls} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="allowPartial" defaultChecked={settings.allow_partial_payments} className="h-4 w-4" />
              Allow partial payments
            </label>
            <Field label="WhatsApp renewal template (English)"
              hint="Placeholders: {{member_first_name}}, {{gym_name}}, {{expiry_date}}">
              <textarea name="waTemplateEn" rows={3} defaultValue={settings.whatsapp_renewal_template_en} className={inputCls} />
            </Field>
            <Field label="WhatsApp renewal template (Telugu)">
              <textarea name="waTemplateTe" rows={3} defaultValue={settings.whatsapp_renewal_template_te} className={inputCls} />
            </Field>
            <Field label="Receipt footer">
              <input name="receiptFooter" defaultValue={settings.receipt_footer ?? ''} className={inputCls} />
            </Field>
            {canManage ? <Button>{tr.common.save}</Button> : null}
          </fieldset>
        </form>
      </Card>
    </>
  );
}
