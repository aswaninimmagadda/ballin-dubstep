import { parseMoney } from '@gymflow/utils';

/**
 * Reads a rupee amount typed at the desk. Staff mistype — a stray letter or a
 * second decimal point must come back as a form error, not an exception that
 * escapes the server action and throws away everything else they entered.
 */
export type AmountInput = { kind: 'empty' } | { kind: 'ok'; paise: number } | { kind: 'invalid' };

export function readAmount(raw: unknown): AmountInput {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return { kind: 'empty' };
  try {
    return { kind: 'ok', paise: parseMoney(trimmed) };
  } catch {
    return { kind: 'invalid' };
  }
}

export const AMOUNT_ERROR = 'Enter the amount in rupees — for example 2500 or 2500.50.';
