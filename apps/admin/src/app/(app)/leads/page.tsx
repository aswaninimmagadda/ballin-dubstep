import { redirect } from 'next/navigation';
import { formatDisplayDate, whatsappLink } from '@gymflow/utils';
import { createLeadSchema } from '@gymflow/validation';
import { requirePermission } from '@/lib/session';
import { createLead, listLeads, updateLeadStatus } from '@/lib/services/leads';
import { asPrincipal } from '@/lib/db';
import { toUserMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { requireFeature } from '@/lib/flags';
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

async function createLeadAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('leads.manage');
  const parsed = createLeadSchema.safeParse({
    branchId: String(formData.get('branchId')),
    name: String(formData.get('name')),
    mobile: String(formData.get('mobile')),
    source: String(formData.get('source')),
    followUpDate: String(formData.get('followUpDate') ?? '') || null,
    notes: String(formData.get('notes') ?? '') || null,
  });
  if (!parsed.success) redirect(`/leads?error=${encodeURIComponent('Check the lead details.')}`);
  try {
    await createLead(user, parsed.data);
  } catch (err) {
    redirect(`/leads?error=${encodeURIComponent(toUserMessage(err))}`);
  }
  redirect('/leads');
}

async function statusAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requirePermission('leads.manage');
  await updateLeadStatus(user, {
    id: String(formData.get('id')),
    status: String(formData.get('status')),
  });
  redirect('/leads');
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; all?: string }>;
}) {
  const user = await requirePermission('leads.view');
  await requireFeature(user, 'leads');
  const { error } = await searchParams;
  const tr = await t();
  const leads = await listLeads(user);
  const branches = await asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(`SELECT id, name FROM branches WHERE is_active ORDER BY name`);
    return r.rows as { id: string; name: string }[];
  });

  return (
    <>
      <PageHeader title={`${tr.leads.title} (${leads.length})`} />
      <ErrorBanner message={error ?? null} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">{tr.leads.newLead}</h2>
          <form action={createLeadAction} className="space-y-3">
            <Field label={tr.members.name} required>
              <input name="name" required className={inputCls} />
            </Field>
            <Field label={tr.members.mobile} required>
              <input name="mobile" type="tel" required className={inputCls} />
            </Field>
            <Field label="Branch" required>
              <select name="branchId" className={inputCls}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={tr.leads.source}>
              <select name="source" className={inputCls} defaultValue="walk_in">
                <option value="walk_in">Walk-in</option>
                <option value="phone">Phone</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="social">Instagram/Social</option>
                <option value="referral">Referral</option>
                <option value="website">Website</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label={tr.leads.followUpDate}>
              <input name="followUpDate" type="date" className={inputCls} />
            </Field>
            <Field label={tr.members.notes}>
              <input name="notes" className={inputCls} />
            </Field>
            <Button className="w-full">{tr.common.save}</Button>
          </form>
        </Card>

        <div className="lg:col-span-2">
          <Table
            headers={[
              tr.members.name,
              tr.leads.source,
              tr.leads.followUpDate,
              tr.members.status,
              '',
            ]}
          >
            {leads.map((lead) => (
              <tr key={lead.id}>
                <td className="px-4 py-3">
                  <span className="font-medium">{lead.name}</span>
                  <span className="block text-xs text-slate-400">
                    {lead.mobile.replace('+91', '')}
                  </span>
                </td>
                <td className="px-4 py-3">{lead.source}</td>
                <td className="px-4 py-3">
                  {lead.follow_up_date ? formatDisplayDate(lead.follow_up_date) : '—'}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={lead.status === 'new' ? 'info' : 'default'}>
                    {tr.leads.statuses[lead.status as keyof typeof tr.leads.statuses] ??
                      lead.status}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <a
                      href={whatsappLink(lead.mobile, `Hi ${lead.name}!`)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded px-2 py-1 text-xs font-semibold text-green-700 hover:bg-green-50"
                    >
                      WA
                    </a>
                    <a
                      href={`tel:${lead.mobile}`}
                      className="rounded px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                    >
                      {tr.members.call}
                    </a>
                    <a
                      href={`/members/new?lead=${lead.id}`}
                      className="rounded bg-primary px-2 py-1 text-xs font-semibold text-white hover:bg-primary-dark"
                    >
                      {tr.leads.convert}
                    </a>
                    <form action={statusAction}>
                      <input type="hidden" name="id" value={lead.id} />
                      <input type="hidden" name="status" value="lost" />
                      <button
                        className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-100"
                        title="Mark lost"
                      >
                        ✕
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        </div>
      </div>
    </>
  );
}
