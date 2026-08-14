import { NextResponse } from 'next/server';
import { hasPermission } from '@gymflow/core';
import { currentUser } from '@/lib/session';
import { exportCsv } from '@/lib/services/reports';
import { asPrincipal } from '@/lib/db';
import { writeAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const KINDS = ['members', 'memberships', 'payments', 'attendance'] as const;
type Kind = (typeof KINDS)[number];

/** Tenant-authorized CSV export. RLS guarantees only own-tenant rows. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ kind: string }> },
): Promise<NextResponse> {
  const user = await currentUser();
  if (!user || user.kind === 'member') {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  if (user.kind !== 'platform_admin' && !hasPermission(user.permissions, 'reports.export')) {
    return NextResponse.json({ error: 'Missing permission: reports.export' }, { status: 403 });
  }
  const { kind } = await params;
  if (!KINDS.includes(kind as Kind)) {
    return NextResponse.json({ error: 'Unknown export' }, { status: 404 });
  }
  const csv = await exportCsv(user, kind as Kind);
  await asPrincipal(user.claims, (tx) =>
    writeAudit(tx, user, { action: 'export.csv', entityType: 'export', after: { kind } }),
  );
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${kind}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
