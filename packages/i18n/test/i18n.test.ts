import { describe, it, expect } from 'vitest';
import { en, te, getTranslations, renderTemplate } from '../src/index';

function collectKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null
      ? collectKeys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe('translation completeness', () => {
  it('te has exactly the same keys as en', () => {
    expect(collectKeys(te as never).sort()).toEqual(collectKeys(en as never).sort());
  });
  it('no empty translations', () => {
    const empties = collectKeys(te as never).filter((k) => {
      const val = k
        .split('.')
        .reduce<unknown>((o, part) => (o as Record<string, unknown>)[part], te);
      return typeof val === 'string' && val.trim() === '';
    });
    expect(empties).toEqual([]);
  });
  /**
   * Key parity is not enough. A Telugu string that drops a {{placeholder}}
   * renders a sentence with a hole in it — "ఇంకా రోజులు" instead of
   * "ఇంకా 12 రోజులు" — and nothing else in the build would notice, because
   * the key is present and the value is not empty.
   */
  it('every placeholder in en appears in te, and vice versa', () => {
    const placeholders = (v: unknown): string[] =>
      typeof v === 'string' ? [...v.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!).sort() : [];
    const at = (tree: unknown, key: string): unknown =>
      key.split('.').reduce<unknown>((o, part) => (o as Record<string, unknown>)[part], tree);

    const mismatches = collectKeys(en as never)
      .map((key) => {
        const a = placeholders(at(en, key));
        const b = placeholders(at(te, key));
        return a.join(',') === b.join(',') ? null : `${key}: en[${a}] te[${b}]`;
      })
      .filter(Boolean);
    expect(mismatches).toEqual([]);
  });

  /**
   * A Telugu value identical to the English one is almost always an
   * untranslated placeholder someone meant to come back to. Proper nouns and
   * codes legitimately match, so those are listed rather than guessed at.
   */
  it('no Telugu string is just the English copied across', () => {
    // Things that are the same in both languages because they are names,
    // codes or acronyms rather than prose. Each one is a deliberate entry,
    // not a backlog: if a real translation is missing it belongs in te.ts,
    // not here.
    const ALLOWED = new Set([
      'common.appName', // the product name
      'ui.andhraPradesh', // written the same in the Telugu UI
      'ui.gstin', // the acronym, used as a field label
      'payments.methods.upi', // the payment system's own name
      'ui.sankranti27', // an example promo code shown as a placeholder
    ]);
    const at = (tree: unknown, key: string): unknown =>
      key.split('.').reduce<unknown>((o, part) => (o as Record<string, unknown>)[part], tree);

    const untranslated = collectKeys(en as never).filter((key) => {
      if (ALLOWED.has(key)) return false;
      const a = at(en, key);
      const b = at(te, key);
      if (typeof a !== 'string' || typeof b !== 'string') return false;
      // Anything with no Latin letters at all is fine (numbers, symbols).
      if (!/[A-Za-z]{3}/.test(a)) return false;
      return a === b;
    });
    expect(untranslated).toEqual([]);
  });

  it('falls back to en for unknown language', () => {
    expect(getTranslations('xx' as never)).toBe(en);
  });
});

describe('renderTemplate', () => {
  it('substitutes placeholders', () => {
    expect(
      renderTemplate('Hi {{member_first_name}}, expires {{expiry_date}}.', {
        member_first_name: 'Ravi',
        expiry_date: '30-Nov-2026',
      }),
    ).toBe('Hi Ravi, expires 30-Nov-2026.');
  });
  it('leaves unknown placeholders visible', () => {
    expect(renderTemplate('Hi {{unknown_thing}}', {})).toBe('Hi {{unknown_thing}}');
  });
});
