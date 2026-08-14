import { requirePermission } from '@/lib/session';
import { asPrincipal } from '@/lib/db';
import { t } from '@/lib/i18n';
import { Badge, EmptyState, PageHeader, Table } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  const user = await requirePermission('audit.view');
  const tr = await t();
  const rows = await asPrincipal(user.claims, async (tx) => {
    const r = await tx.query(
      `SELECT id, actor_label, action, entity_type, entity_id, after,
              created_at::text AS created_at
       FROM audit_logs ORDER BY created_at DESC LIMIT 200`,
    );
    return r.rows as Record<string, unknown>[];
  });

  return (
    <>
      <PageHeader
        title={tr.nav.audit}
        subtitle="Append-only — entries can never be edited or deleted."
      />
      {rows.length === 0 ? (
        <EmptyState title="No activity yet." />
      ) : (
        <Table headers={['When', 'Who', 'Action', 'Entity', 'Details']}>
          {rows.map((row) => (
            <tr key={String(row.id)}>
              <td className="px-4 py-3 text-xs text-slate-500">
                {new Date(String(row.created_at)).toLocaleString('en-IN', {
                  timeZone: 'Asia/Kolkata',
                })}
              </td>
              <td className="px-4 py-3">{String(row.actor_label)}</td>
              <td className="px-4 py-3">
                <Badge tone="info">{String(row.action)}</Badge>
              </td>
              <td className="px-4 py-3 text-slate-500">{String(row.entity_type)}</td>
              <td className="px-4 py-3 text-xs text-slate-500">
                {row.after ? JSON.stringify(row.after).slice(0, 120) : '—'}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
