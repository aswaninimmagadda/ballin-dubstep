import { formatDisplayDate, formatMoney } from '@gymflow/utils';
import type { TranslationTree } from '@gymflow/i18n';

/**
 * Formatting for member eyes.
 *
 * The screens used to print whatever the API sent: `2026-08-29` on the
 * payments list, `2026-08-29 → 2026-11-29` on a personal-training package,
 * and a home screen with its own copy of the English month names — so a
 * member reading the app in Telugu still got "29-Aug-2026".
 */
export function memberDate(iso: string | null | undefined, t: TranslationTree): string {
  if (!iso) return '—';
  // The API sends plain calendar dates (YYYY-MM-DD) and timestamps. Take the
  // date part: a check-in at 06:15 IST must not slide to the previous day.
  const date = iso.slice(0, 10);
  try {
    return formatDisplayDate(date, 'DD-Mon-YYYY', t.member.monthsShort);
  } catch {
    return date;
  }
}

/**
 * A timestamp with the time of day, for the check-in list. Built from the
 * parts rather than toLocaleString, which was pinned to 'en-IN' and so
 * printed English months on a Telugu screen.
 */
export function memberDateTime(iso: string, t: TranslationTree): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Times are shown in the gym's timezone; every gym in the pilot is IST.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const day = get('day');
  const month = t.member.monthsShort[Number(get('month')) - 1] ?? get('month');
  return `${day}-${month}-${get('year')} · ${get('hour')}:${get('minute')}`;
}

export function rupees(paise: number): string {
  return formatMoney(paise);
}
