import { en, type TranslationTree } from './en';
import { te } from './te';

export type { TranslationTree };
export { en, te };

export type Language = 'en' | 'te';

export const LANGUAGES: { tag: Language; label: string; nativeLabel: string }[] = [
  { tag: 'en', label: 'English', nativeLabel: 'English' },
  { tag: 'te', label: 'Telugu', nativeLabel: 'తెలుగు' },
];

const resources: Record<Language, TranslationTree> = { en, te };

export function getTranslations(lang: Language): TranslationTree {
  return resources[lang] ?? en;
}

/**
 * Render a {{placeholder}} template (WhatsApp/notification templates).
 * Unknown placeholders are left visible so a broken template is noticed,
 * not silently blanked.
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : whole,
  );
}
