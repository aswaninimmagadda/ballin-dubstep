/**
 * Receipt number formatting. The *sequence* itself is allocated atomically in
 * the database (per tenant + fiscal year, under a row lock) — this module only
 * formats. Format: {PREFIX}-{FY}-{SEQ padded}. Example: GYM-2026-000123.
 */

export function fiscalYearLabel(isoDate: string): string {
  // Indian fiscal year: 1 Apr – 31 Mar. FY label = starting calendar year.
  const [y, m] = isoDate.split('-').map(Number) as [number, number];
  return String(m >= 4 ? y : y - 1);
}

export function formatReceiptNumber(opts: {
  prefix: string;
  fiscalYear: string;
  sequence: number;
  padding?: number;
}): string {
  const { prefix, fiscalYear, sequence, padding = 6 } = opts;
  if (!Number.isInteger(sequence) || sequence <= 0) {
    throw new Error(`sequence must be a positive integer, got ${sequence}`);
  }
  return `${prefix}-${fiscalYear}-${String(sequence).padStart(padding, '0')}`;
}

export function formatMembershipNumber(prefix: string, n: number, padding = 4): string {
  return `${prefix}${String(n).padStart(padding, '0')}`;
}
