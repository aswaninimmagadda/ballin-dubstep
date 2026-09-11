'use client';
import { getTranslations, type Language, type TranslationTree } from '@gymflow/i18n';

/**
 * Translations for a client component.
 *
 * The server-side resolver in lib/i18n.ts is async — it reads a cookie and
 * falls back to the staff member's profile language — and a client component
 * cannot await it. Error boundaries are the case that forces the issue: they
 * must be client components, and an error page that is only ever in English
 * is an error page half this product's users cannot read.
 *
 * The root layout puts the resolved language on <html lang>, so the client
 * reads it from there rather than guessing. That attribute has to be right
 * anyway — it is what screen readers and browser translation go by.
 */
export function clientLanguage(): Language {
  if (typeof document === 'undefined') return 'en';
  return document.documentElement.lang === 'te' ? 'te' : 'en';
}

export function clientTranslations(): TranslationTree {
  return getTranslations(clientLanguage());
}
