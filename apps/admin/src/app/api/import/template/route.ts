import { NextResponse } from 'next/server';
import { hasPermission } from '@gymflow/core';
import { currentUser } from '@/lib/session';
import { importTemplateCsv } from '@/lib/services/import';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const user = await currentUser();
  if (!user || user.kind === 'member') {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  if (user.kind !== 'platform_admin' && !hasPermission(user.permissions, 'import.run')) {
    return NextResponse.json({ error: 'Missing permission: import.run' }, { status: 403 });
  }
  // BOM for the same reason as the exports: Excel guesses the encoding.
  return new NextResponse(`\uFEFF${importTemplateCsv()}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="gymflow-member-import-template.csv"',
    },
  });
}
