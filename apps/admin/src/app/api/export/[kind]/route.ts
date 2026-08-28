import { NextResponse } from 'next/server';
import { hasPermission } from '@gymflow/core';
import { currentUser } from '@/lib/session';
import { exportCsv } from '@/lib/services/reports';
import { asPrincipal } from '@/lib/db';
import { writeAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const KINDS = ['members', 'memberships', 'payments', 'attendance', 'dues'] as const;
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
  // Excel ignores the charset in the HTTP header and guesses the encoding from
  // the bytes, so a UTF-8 CSV of Telugu names opens as mojibake unless it
  // starts with a BOM. Every other tool skips it silently.
  return new NextResponse(`\uFEFF${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${kind}-${new Date().toISOString().slice(0, 10)}.csv"`,
      // An export is a full dump of the gym's member and payment data; it must
      // not sit in a shared browser or proxy cache.
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
