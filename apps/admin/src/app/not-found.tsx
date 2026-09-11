import { t } from '@/lib/i18n';
import { NotFoundBody } from '@/components/boundary';

export const dynamic = 'force-dynamic';

/** Catches notFound() outside the (app) shell — receipts, public pages, typos. */
export default async function RootNotFound() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <NotFoundBody tr={await t()} />
    </main>
  );
}
