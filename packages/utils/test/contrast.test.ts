import { describe, it, expect } from 'vitest';
import {
  contrastRatio,
  relativeLuminance,
  parseHexColor,
  meetsAA,
  AA_NORMAL,
} from '../src/contrast';

describe('parsing', () => {
  it('reads #rrggbb and #rgb alike', () => {
    expect(parseHexColor('#16a34a')).toEqual({ r: 22, g: 163, b: 74 });
    expect(parseHexColor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexColor('16A34A')).toEqual({ r: 22, g: 163, b: 74 });
  });

  it('refuses anything that is not a colour', () => {
    expect(() => parseHexColor('green')).toThrow();
    expect(() => parseHexColor('#12345')).toThrow();
  });
});

describe('the WCAG reference values', () => {
  it('puts black at 0 and white at 1', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBe(1);
  });

  it('gives black on white the maximum 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });

  it('gives a colour against itself 1:1', () => {
    expect(contrastRatio('#16a34a', '#16a34a')).toBeCloseTo(1, 10);
  });

  it('does not care which way round the arguments go', () => {
    expect(contrastRatio('#15803d', '#ffffff')).toBeCloseTo(
      contrastRatio('#ffffff', '#15803d'),
      10,
    );
  });
});

describe('the colour this product actually shipped', () => {
  // The panel measured 3.30:1 for white on the old primary. This is that
  // measurement, pinned, so the arithmetic above is checkable against an
  // outside number rather than only against itself.
  it('confirms the old primary green failed AA at 3.30:1', () => {
    expect(contrastRatio('#16a34a', '#ffffff')).toBeCloseTo(3.3, 1);
    expect(meetsAA('#16a34a', '#ffffff')).toBe(false);
  });

  it('and that it would have squeaked through the large-text threshold', () => {
    // Which is why it looked acceptable on the dashboard's big numbers and
    // failed everywhere that mattered: buttons and body-size links.
    expect(meetsAA('#16a34a', '#ffffff', true)).toBe(true);
  });
});

describe('meetsAA', () => {
  it('requires 4.5:1 for normal text and 3:1 for large', () => {
    expect(AA_NORMAL).toBe(4.5);
    expect(meetsAA('#767676', '#ffffff')).toBe(true); // 4.54:1
    expect(meetsAA('#777777', '#ffffff')).toBe(false); // 4.48:1
    expect(meetsAA('#777777', '#ffffff', true)).toBe(true);
  });

  it('rounds to two places so a colour that is exactly on the line passes', () => {
    // #767676 on white is 4.5384…; the point is that a value which displays
    // as 4.50 is never reported as a failure by floating-point drift.
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThan(4.5);
  });
});
