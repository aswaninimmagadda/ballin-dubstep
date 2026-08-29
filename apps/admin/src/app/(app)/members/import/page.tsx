import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/session';
import {
  deleteStashedCsv,
  executeImport,
  loadStashedCsv,
  previewImport,
  stashCsv,
  type ImportPreview,
} from '@/lib/services/import';
import { toUserMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
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

/**
 * CSV import: paste/upload → server-side validation → dry-run preview with
 * per-row errors → confirm (blocked while any row has errors). The CSV is
 * parked server-side (never in a URL — it is member PII) and digest-checked
 * so what you previewed is exactly what imports.
 */

async function previewAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('import.run');
  const file = formData.get('file');
  let csv = String(formData.get('csv') ?? '');
  if (file instanceof File && file.size > 0) csv = await file.text();
  if (!csv.trim())
    redirect(`/members/import?error=${encodeURIComponent('Paste CSV rows or choose a file.')}`);
  const stashId = await stashCsv(user, csv);
  redirect(`/members/import?stash=${stashId}`);
}

async function confirmAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('import.run');
  const stashId = String(formData.get('stash') ?? '');
  const digest = String(formData.get('digest') ?? '');
  const csv = await loadStashedCsv(user, stashId);
  if (csv == null) {
    redirect(
      `/members/import?error=${encodeURIComponent('The preview has expired. Upload the file again.')}`,
    );
  }
  try {
    const result = await executeImport(user, csv, digest);
    await deleteStashedCsv(user, stashId);
    redirect(`/members/import?done=${result.imported}&receipts=${result.receipts}`);
  } catch (err) {
    if ((err as { digest?: string }).digest?.startsWith('NEXT_REDIRECT')) throw err;
    redirect(`/members/import?error=${encodeURIComponent(toUserMessage(err))}`);
  }
}

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; stash?: string; done?: string; receipts?: string }>;
}) {
  const user = await requirePermission('import.run');
  const { error, stash, done, receipts } = await searchParams;
  const tr = await t();

  let preview: ImportPreview | null = null;
  let previewError: string | null = null;
  if (stash) {
    const csv = await loadStashedCsv(user, stash);
    if (csv == null) {
      previewError = 'The preview has expired. Upload the file again.';
    } else {
      try {
        preview = await previewImport(user, csv);
      } catch (err) {
        previewError = toUserMessage(err);
      }
    }
  }

  return (
    <>
      <PageHeader
        title={tr.ui.importMembersFromCsv}
        subtitle="Migrate from notebooks/Excel. Nothing imports until every row is valid."
        actions={
          <Button href="/api/import/template" variant="secondary">
            Download template
          </Button>
        }
      />
      <ErrorBanner message={error ?? previewError} />
      <SuccessBanner
        message={
          done ? `Imported ${done} member(s), ${receipts} payment receipt(s) created.` : null
        }
      />

      {!preview ? (
        <Card className="max-w-2xl">
          <form action={previewAction} className="space-y-4">
            <label className="block text-sm font-medium text-slate-700">
              CSV file
              <input
                type="file"
                name="file"
                accept=".csv,text/csv"
                className="mt-1 block w-full text-sm"
              />
            </label>
            <div className="text-center text-xs text-slate-400">— or paste rows —</div>
            <textarea
              name="csv"
              rows={8}
              className={inputCls}
              placeholder={
                'member_name,mobile,membership_plan,start_date,...\nRavi Kumar,9876543210,3 Month,2026-05-01,...'
              }
            />
            <Button>Validate & preview (dry run)</Button>
          </form>
        </Card>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-3">
            <Badge tone={preview.errorCount === 0 ? 'success' : 'danger'}>
              {preview.validCount} valid · {preview.errorCount} with errors
            </Badge>
            {preview.errorCount === 0 ? (
              <form action={confirmAction}>
                <input type="hidden" name="stash" value={stash} />
                <input type="hidden" name="digest" value={preview.digest} />
                <Button>Confirm import ({preview.validCount} members)</Button>
              </form>
            ) : (
              <span className="text-sm text-red-600">
                Fix the errors in your file and preview again.
              </span>
            )}
            <Button href="/members/import" variant="secondary" type="button">
              Start over
            </Button>
          </div>

          <Table
            headers={[
              'Line',
              tr.members.name,
              tr.members.mobile,
              tr.members.plan,
              'Dates',
              'Result',
            ]}
          >
            {preview.rows.map((row) => (
              <tr key={row.line} className={row.errors.length ? 'bg-red-50' : ''}>
                <td className="px-4 py-2 text-slate-400">{row.line}</td>
                <td className="px-4 py-2">{row.raw.member_name}</td>
                <td className="px-4 py-2">{row.raw.mobile}</td>
                <td className="px-4 py-2">{row.raw.membership_plan}</td>
                <td className="px-4 py-2 text-xs">
                  {row.raw.start_date} → {row.raw.expiry_date || 'auto'}
                </td>
                <td className="px-4 py-2 text-xs">
                  {row.errors.length > 0 ? (
                    <span className="text-red-700">{row.errors.join('; ')}</span>
                  ) : row.warnings.length > 0 ? (
                    <span className="text-amber-700">{row.warnings.join('; ')}</span>
                  ) : (
                    <span className="text-green-700">OK</span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </>
  );
}
