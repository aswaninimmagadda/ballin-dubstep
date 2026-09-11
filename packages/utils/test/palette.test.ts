import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
