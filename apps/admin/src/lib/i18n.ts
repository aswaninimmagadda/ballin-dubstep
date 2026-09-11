import 'server-only';
import { cookies } from 'next/headers';
import { getTranslations, type Language, type TranslationTree } from '@gymflow/i18n';
import { currentUser } from './session';

export const LANG_COOKIE = 'gymflow_lang';

/** Effective language: explicit cookie > user profile > English. */
export async function currentLanguage(): Promise<Language> {
  const jar = await cookies();
  const fromCookie = jar.get(LANG_COOKIE)?.value;
  if (fromCookie === 'en' || fromCookie === 'te') return fromCookie;
  try {
    const user = await currentUser();
    return user?.language ?? 'en';
  } catch {
    // The root layout calls this to set <html lang>, so a database blip
    // would otherwise take the whole document down to global-error —
    // including /login and the public pages, which need no database at all.
    // A wrong language is a far smaller failure than a blank app.
    return 'en';
  }
}

export async function t(): Promise<TranslationTree> {
  return getTranslations(await currentLanguage());
}
