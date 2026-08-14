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
      const val = k.split('.').reduce<unknown>((o, part) => (o as Record<string, unknown>)[part], te);
      return typeof val === 'string' && val.trim() === '';
    });
    expect(empties).toEqual([]);
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
