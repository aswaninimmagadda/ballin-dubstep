/**
 * WCAG 2.1 contrast ratios.
 *
 * The product ships to gym counters — bright rooms, cheap monitors, and staff
 * who are middle-aged more often than not. Colour pairs that only just work on
 * a designer's laptop do not work there, and "looks fine to me" is not a test.
 * These functions exist so the shipped palette can be asserted in CI rather
 * than eyeballed.
 */

/** Relative luminance of an sRGB channel, per WCAG 2.1. */
function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Parse `#rgb` or `#rrggbb` (case-insensitive) into 0-255 components. */
export function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const raw = hex.trim().replace(/^#/, '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`Not a hex colour: ${hex}`);
  }
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Relative luminance of a colour, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHexColor(hex);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * Contrast ratio between two colours, 1 (identical) to 21 (black on white).
 * Order does not matter.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * WCAG thresholds. "Large" is 18.66px bold or 24px regular and up — which in
 * this app means page headings and the big stat numbers, nothing a member or a
 * receptionist has to read at body size.
 */
export const AA_NORMAL = 4.5;
export const AA_LARGE = 3;
export const AAA_NORMAL = 7;

export function meetsAA(a: string, b: string, large = false): boolean {
  // Rounded to 2dp first: 4.4999 is not a pass anyone can see, but 4.499999
  // from floating-point drift on a colour that is exactly 4.5 would be a
  // spurious failure.
  return Math.round(contrastRatio(a, b) * 100) / 100 >= (large ? AA_LARGE : AA_NORMAL);
}

/**
 * The text colour to put on a given background: whichever of white or the
 * product's near-black gives the better contrast.
 *
 * This exists because gyms choose their own brand colour in Settings and the
 * member app paints every primary button with it. A gym that picks a bright
 * yellow was, until this, shipping white-on-yellow buttons to its own members
 * at 1.6:1 — invisible. Nobody at the gym would necessarily notice: the owner
 * picked the colour on a desktop monitor, and the people who cannot read it
 * are not the people who chose it.
 */
export function readableTextOn(background: string): '#ffffff' | '#0f172a' {
  return contrastRatio(background, '#ffffff') >= contrastRatio(background, '#0f172a')
    ? '#ffffff'
    : '#0f172a';
}

/**
 * Is this an acceptable brand colour for a button with text on it? True when
 * SOME foreground clears AA — which, since white and near-black sit at
 * opposite ends, only fails for mid-tone colours where neither works.
 */
export function isUsableAsFill(background: string): boolean {
  return meetsAA(background, readableTextOn(background));
}
