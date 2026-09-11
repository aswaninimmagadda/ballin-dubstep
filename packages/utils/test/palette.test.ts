import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESIGN_TOKENS } from '@gymflow/config';
import { contrastRatio, meetsAA, readableTextOn, isUsableAsFill } from '../src/contrast';

/**
 * The shipped palette, asserted.
 *
 * An accessibility audit is a one-off; a test is not. The brand green shipped
 * at 3.30:1 — under the WCAG AA floor for body text — because nobody had ever
 * measured it, and nothing would have told them. These assertions are what
 * "nobody measured it" costs now.
 */

const WHITE = '#ffffff';

/** Tokens used as a solid fill with white text on top. */
const WHITE_TEXT_FILLS = [
  'primary',
  'primaryDark',
  'accent',
  'danger',
  'warning',
  'success',
  'info',
] as const;

describe('design tokens meet WCAG AA', () => {
  it.each(WHITE_TEXT_FILLS)('%s carries white text at 4.5:1 or better', (token) => {
    const hex = DESIGN_TOKENS.color[token];
    const ratio = contrastRatio(hex, WHITE);
    expect(
      meetsAA(hex, WHITE),
      `${token} (${hex}) is ${ratio.toFixed(2)}:1 against white — needs 4.5:1`,
    ).toBe(true);
  });

  it('muted text is readable on both surfaces', () => {
    const { textMuted, surface, surfaceMuted } = DESIGN_TOKENS.color;
    expect(meetsAA(textMuted, surface)).toBe(true);
    expect(meetsAA(textMuted, surfaceMuted)).toBe(true);
  });

  it('body text is comfortably above the floor, not just over it', () => {
    // AAA for the text people read all day at a counter.
    expect(contrastRatio(DESIGN_TOKENS.color.text, DESIGN_TOKENS.color.surface)).toBeGreaterThan(7);
  });

  it('the hover step is distinguishable from the primary, not just darker', () => {
    const { primary, primaryDark } = DESIGN_TOKENS.color;
    expect(primary).not.toBe(primaryDark);
    // Enough of a step to be visible, but still the same colour family.
    const step = contrastRatio(primary, primaryDark);
    expect(step).toBeGreaterThan(1.2);
    expect(step).toBeLessThan(2.5);
  });
});

describe('the admin CSS copy of the tokens cannot drift', () => {
  // Tailwind cannot read TypeScript, so apps/admin/src/app/globals.css repeats
  // the values. Two copies of a constant is exactly how one of them ends up
  // wrong, so the duplicate is asserted rather than trusted.
  const css = readFileSync(
    fileURLToPath(new URL('../../../apps/admin/src/app/globals.css', import.meta.url)),
    'utf8',
  );
  const cssVar = (name: string): string | null =>
    css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]?.toLowerCase() ?? null;

  it.each([
    ['primary', 'primary'],
    ['primary-dark', 'primaryDark'],
    ['accent', 'accent'],
    ['danger', 'danger'],
    ['warning', 'warning'],
    ['info', 'info'],
    ['surface', 'surface'],
    ['surface-muted', 'surfaceMuted'],
  ] as const)('--color-%s matches DESIGN_TOKENS.color.%s', (cssName, tokenName) => {
    expect(cssVar(cssName)).toBe(DESIGN_TOKENS.color[tokenName].toLowerCase());
  });
});

describe('member app status chips', () => {
  // Mirrors apps/member/src/lib/theme.ts. A member reads these on a phone in
  // a gym, so they get the same floor as everything else.
  const CHIPS: Record<string, [string, string]> = {
    active: ['#dcfce7', '#166534'],
    expiring_soon: ['#fef3c7', '#92400e'],
    grace_period: ['#fef3c7', '#92400e'],
    frozen: ['#dbeafe', '#1e40af'],
    pending: ['#e0e7ff', '#3730a3'],
    expired: ['#fee2e2', '#991b1b'],
    cancelled: ['#f1f5f9', '#475569'],
  };

  it.each(Object.entries(CHIPS))('%s is readable', (_name, [bg, fg]) => {
    expect(meetsAA(bg, fg)).toBe(true);
  });
});

describe('a gym’s own brand colour stays readable', () => {
  // Gyms set primary_color in Settings and the member app paints every button
  // with it. The label follows the background rather than being hard-coded
  // white, so a gym that picks a bright colour still ships a usable app.
  it.each(['#15803d', '#f59e0b', '#ffff00', '#000000', '#ffffff', '#dc2626', '#e0e7ff'])(
    'picks a readable label for %s',
    (brand) => {
      expect(meetsAA(brand, readableTextOn(brand))).toBe(true);
    },
  );

  it('rejects the mid-tones where neither black nor white works', () => {
    // ~#777 is the worst case: 4.46:1 against near-black, 4.48:1 against
    // white. Settings refuses these rather than shipping them to members.
    expect(isUsableAsFill('#7f7f7f')).toBe(false);
    expect(isUsableAsFill('#808080')).toBe(true);
  });

  it('a bright amber gets dark text, not the white it used to get', () => {
    expect(readableTextOn('#f59e0b')).toBe('#0f172a');
    expect(contrastRatio('#f59e0b', '#ffffff')).toBeLessThan(4.5);
    expect(contrastRatio('#f59e0b', readableTextOn('#f59e0b'))).toBeGreaterThan(4.5);
  });
});

describe('no hard-coded low-contrast button in the admin app', () => {
  /**
   * The design tokens are only half the palette. Three buttons were written
   * as literal Tailwind classes — a green-600 WhatsApp button on the
   * dashboard and the member page, and an amber-500 offline banner — and so
   * sailed past a token audit at 3.30:1 and 2.15:1 respectively.
   *
   * Tailwind's own scale, for the shades this app reaches for.
   */
  const SHADES: Record<string, string> = {
    'green-500': '#22c55e',
    'green-600': '#16a34a',
    'green-700': '#15803d',
    'emerald-600': '#059669',
    'amber-400': '#fbbf24',
    'amber-500': '#f59e0b',
    'amber-600': '#d97706',
    'amber-700': '#b45309',
    'red-500': '#ef4444',
    'red-600': '#dc2626',
    'blue-500': '#3b82f6',
    'blue-600': '#2563eb',
    'sky-500': '#0ea5e9',
    'yellow-400': '#facc15',
    'orange-500': '#f97316',
    'slate-300': '#cbd5e1',
    'slate-400': '#94a3b8',
    'slate-500': '#64748b',
    'slate-600': '#475569',
    'slate-700': '#334155',
    'green-800': '#166534',
    'amber-800': '#92400e',
    'red-700': '#b91c1c',
    'blue-700': '#1d4ed8',
  };

  /**
   * The surfaces text actually sits on in this app: white cards and the
   * slate-50 page background.
   */
  const SURFACES: Record<string, string> = { white: '#ffffff', 'slate-50': '#f8fafc' };

  const dir = fileURLToPath(new URL('../../../apps/admin/src', import.meta.url));

  function walk(d: string, out: string[] = []): string[] {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (entry.name.endsWith('.tsx')) out.push(full);
    }
    return out;
  }

  it('every bg-<colour> paired with text-white clears AA', () => {
    const offenders: string[] = [];
    for (const file of walk(dir)) {
      const src = readFileSync(file, 'utf8');
      // className strings that set both a background shade and white text.
      for (const m of src.matchAll(/class[Nn]ame="([^"]*)"/g)) {
        const cls = m[1] ?? '';
        if (!/\btext-white\b/.test(cls)) continue;
        const bg = cls.match(/\bbg-([a-z]+-\d{3})\b/)?.[1];
        if (!bg) continue;
        const hex = SHADES[bg];
        if (!hex) continue; // a shade this test does not know; not a silent pass for known ones
        if (!meetsAA(hex, WHITE)) {
          offenders.push(
            `${file.slice(dir.length + 1)}: bg-${bg} (${hex}) with white text is ` +
              `${contrastRatio(hex, WHITE).toFixed(2)}:1`,
          );
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  /**
   * The other half, and the half that was actually worse. Checking only
   * bg-<shade> + text-white missed every COLOURED TEXT class on a plain
   * background: `text-slate-400` at 2.56:1 was in fourteen files, and
   * `text-red-500` was the required-field marker on every form in the app.
   */
  /**
   * Files whose text sits on a dark surface set by an ancestor, which this
   * test cannot see from a className alone. Each is checked by hand here
   * rather than left as a silent hole.
   *
   * apps/admin/src/app/platform/layout.tsx paints bg-slate-900 on the header
   * and uses text-slate-300 inside it: 12.02:1, comfortably AAA.
   */
  const DARK_CHROME = new Set(['app/platform/layout.tsx']);

  it('every coloured text class is readable on the surface it sits on', () => {
    const offenders: string[] = [];
    for (const file of walk(dir)) {
      if (DARK_CHROME.has(file.slice(dir.length + 1))) continue;
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/class[Nn]ame="([^"]*)"/g)) {
        const cls = m[1] ?? '';
        // Skip anything painted onto a coloured fill — the check above owns
        // those, and the fill is what the text sits on, not the page.
        if (/\bbg-[a-z]+-\d{3}\b/.test(cls)) continue;
        for (const t of cls.matchAll(/\b(?:placeholder:)?text-([a-z]+-\d{3})\b/g)) {
          const hex = SHADES[t[1] ?? ''];
          if (!hex) continue;
          for (const [name, surface] of Object.entries(SURFACES)) {
            if (!meetsAA(hex, surface)) {
              offenders.push(
                `${file.slice(dir.length + 1)}: text-${t[1]} (${hex}) on ${name} is ` +
                  `${contrastRatio(hex, surface).toFixed(2)}:1`,
              );
            }
          }
        }
      }
    }
    expect([...new Set(offenders)], [...new Set(offenders)].join('\n')).toEqual([]);
  });
});
