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
  const user = await currentUser();
  return user?.language ?? 'en';
}

export async function t(): Promise<TranslationTree> {
  return getTranslations(await currentLanguage());
}
