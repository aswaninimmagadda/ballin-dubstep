/**
 * Money utilities. All amounts are integer minor units (paise for INR).
 * Floating point is never used for arithmetic; formatting divides only at
 * the display boundary.
 */

export class MoneyError extends Error {}

/** Assert an amount is a safe non-negative integer of minor units. */
export function assertMinorUnits(amount: number, label = 'amount'): number {
  if (!Number.isSafeInteger(amount)) {
    throw new MoneyError(`${label} must be an integer of minor units, got ${amount}`);
  }
  return amount;
}

export function addMoney(a: number, b: number): number {
  assertMinorUnits(a, 'a');
  assertMinorUnits(b, 'b');
  const sum = a + b;
  assertMinorUnits(sum, 'sum');
  return sum;
}

export function subtractMoney(a: number, b: number): number {
  assertMinorUnits(a, 'a');
  assertMinorUnits(b, 'b');
  return a - b;
}

/**
 * Apply a percentage expressed in basis points (1 bps = 0.01%).
 * Uses integer arithmetic with half-up rounding.
 * e.g. percentOf(100000, 1050) = 10500 (10.5% of ₹1000.00 = ₹105.00)
 */
export function percentOf(amount: number, bps: number): number {
  assertMinorUnits(amount, 'amount');
  if (!Number.isSafeInteger(bps) || bps < 0) {
    throw new MoneyError(`bps must be a non-negative integer, got ${bps}`);
  }
  // amount * bps may exceed safe range for huge values; use BigInt for safety.
  const result = (BigInt(amount) * BigInt(bps) + 5000n) / 10000n;
  const n = Number(result);
  assertMinorUnits(n, 'result');
  return n;
}

export interface DiscountInput {
  baseAmount: number; // minor units
  kind: 'percentage' | 'flat' | 'joining_fee_waiver';
  /** bps for percentage, minor units for flat. */
  value: number;
  maxDiscountAmount?: number | null;
  joiningFee?: number; // for joining_fee_waiver
}

export interface DiscountResult {
  discount: number;
  payable: number;
}

/**
 * Compute a discount. The discount is always clamped so the payable amount
 * can never go below zero, and never exceeds maxDiscountAmount when set.
 */
export function applyDiscount(input: DiscountInput): DiscountResult {
  const base = assertMinorUnits(input.baseAmount, 'baseAmount');
  let discount: number;
  switch (input.kind) {
    case 'percentage':
      discount = percentOf(base, input.value);
      break;
    case 'flat':
      discount = assertMinorUnits(input.value, 'flat discount');
      break;
    case 'joining_fee_waiver':
      discount = assertMinorUnits(input.joiningFee ?? 0, 'joiningFee');
      break;
  }
  if (input.maxDiscountAmount != null) {
    discount = Math.min(discount, assertMinorUnits(input.maxDiscountAmount, 'maxDiscountAmount'));
  }
  discount = Math.min(discount, base); // discount can never exceed the base
  discount = Math.max(discount, 0);
  return { discount, payable: base - discount };
}

export interface TaxBreakdown {
  /** Amount excluding tax. */
  net: number;
  tax: number;
  /** Amount including tax (what the customer pays). */
  gross: number;
}

/**
 * Split an amount into net + tax for a rate in basis points.
 * When `inclusive`, `amount` is the gross (tax already inside).
 */
export function computeTax(amount: number, rateBps: number, inclusive: boolean): TaxBreakdown {
  assertMinorUnits(amount, 'amount');
  if (rateBps === 0) return { net: amount, tax: 0, gross: amount };
  if (inclusive) {
    // net = gross * 10000 / (10000 + rate), half-up
    const net = Number(
      (BigInt(amount) * 10000n + BigInt(10000 + rateBps) / 2n) / BigInt(10000 + rateBps),
    );
    return { net, tax: amount - net, gross: amount };
  }
  const tax = percentOf(amount, rateBps);
  return { net: amount, tax, gross: amount + tax };
}

/** Format minor units for display, e.g. 150000 -> "₹1,500.00" (en-IN). */
export function formatMoney(
  minorUnits: number,
  opts: { currency?: string; locale?: string; hidePaiseIfZero?: boolean } = {},
): string {
  assertMinorUnits(minorUnits, 'minorUnits');
  const { currency = 'INR', locale = 'en-IN', hidePaiseIfZero = true } = opts;
  const major = minorUnits / 100; // display-only division
  const noPaise = hidePaiseIfZero && minorUnits % 100 === 0;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: noPaise ? 0 : 2,
    maximumFractionDigits: noPaise ? 0 : 2,
  }).format(major);
}

/** Parse a user-entered rupee string ("1500", "1,500.50", "₹1500") to paise. */
export function parseMoney(input: string): number {
  const cleaned = input.replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new MoneyError(`Cannot parse money value: ${input}`);
  }
  const [rupees = '0', paise = ''] = cleaned.split('.');
  const minor = parseInt(rupees, 10) * 100 + parseInt(paise.padEnd(2, '0') || '0', 10);
  return assertMinorUnits(minor, 'parsed');
}
