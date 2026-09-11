import { t } from '@/lib/i18n';
import { BoundaryLink, BoundaryMessage } from '@/components/boundary';

export const dynamic = 'force-dynamic';

/**
 * The one "this page cannot be shown" screen that was still English-only,
 * and the one a Telugu-speaking receptionist is most likely to meet: it is
 * what requirePermission sends them to.
 */
export default async function ForbiddenPage() {
  const tr = await t();
  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <BoundaryMessage title={tr.errors.forbiddenTitle} body={tr.errors.forbiddenBody}>
        <BoundaryLink href="/" label={tr.errors.notFoundAction} />
      </BoundaryMessage>
    </main>
  );
}
