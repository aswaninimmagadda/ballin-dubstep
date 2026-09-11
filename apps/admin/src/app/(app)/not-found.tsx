import { t } from '@/lib/i18n';
import { NotFoundBody } from '@/components/boundary';

export const dynamic = 'force-dynamic';

export default async function AppNotFound() {
  return <NotFoundBody tr={await t()} />;
}
