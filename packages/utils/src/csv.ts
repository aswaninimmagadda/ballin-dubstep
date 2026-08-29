/**
 * CSV field escaping, including the spreadsheet formula-injection guard.
 *
 * The guard exists because Excel and LibreOffice treat a cell beginning with
 * `=`, `+`, `-`, `@`, TAB or CR as a formula, so a member's "name" of
 * `=HYPERLINK(...)` becomes executable content in whoever opens the export.
 * Prefixing an apostrophe forces the cell to text.
 *
 * The subtlety is that a blanket rule on `+` and `-` is worse than useless
 * here: every Indian mobile number is stored E.164 and every export the gym
 * sends its accountant came out as `'+919876543210`, and every negative amount
 * as `'-500`. A leading `+` or `-` can only start a formula when what follows
 * it is not simply a number, so that is exactly what this checks.
 */
export function csvEscape(value: unknown): string {
  let s = value == null ? '' : String(value);
  const startsFormula = /^[=@\t\r]/.test(s);
  // A leading + or - is safe when the rest reads as a number: digits,
  // separators, spaces and the brackets used in Indian landline formats.
  const signedNumber = /^[+-][\d\s(),.+-]*$/.test(s);
  if (startsFormula || (/^[+-]/.test(s) && !signedNumber)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Render rows as a CSV document, taking the header order from the first row. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]!);
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(',')),
  ].join('\n');
}
