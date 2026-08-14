import { applyDiscount, computeTax, addMoney } from '@gymflow/utils';
import type { MembershipPlanVersion, Promotion } from '@gymflow/types';

export interface QuoteLine {
  label: string;
  amount: number; // minor units
}

export interface MembershipQuote {
  lines: QuoteLine[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

/**
 * Price a membership sale from a plan version + optional promotion.
 * All arithmetic in integer minor units; result is what the member pays.
 */
export function quoteMembership(opts: {
  planVersion: Pick<
    MembershipPlanVersion,
    'basePrice' | 'joiningFee' | 'taxRateBps' | 'taxInclusive'
  >;
  planName: string;
  includeJoiningFee: boolean;
  promotion?: Pick<Promotion, 'discountKind' | 'discountValue' | 'maxDiscountAmount'> | null;
  manualDiscount?: number; // flat minor units, on top of promotion? No — mutually exclusive, validated by caller
}): MembershipQuote {
  const { planVersion: pv, includeJoiningFee, promotion, manualDiscount } = opts;
  const lines: QuoteLine[] = [{ label: opts.planName, amount: pv.basePrice }];
  let subtotal = pv.basePrice;
  const joiningFee = includeJoiningFee ? pv.joiningFee : 0;
  if (joiningFee > 0) {
    lines.push({ label: 'Joining fee', amount: joiningFee });
    subtotal = addMoney(subtotal, joiningFee);
  }

  let discount = 0;
  if (promotion) {
    discount = applyDiscount({
      baseAmount: subtotal,
      kind: promotion.discountKind,
      value: promotion.discountValue,
      maxDiscountAmount: promotion.maxDiscountAmount,
      joiningFee,
    }).discount;
  } else if (manualDiscount && manualDiscount > 0) {
    discount = Math.min(manualDiscount, subtotal);
  }

  const discounted = subtotal - discount;
  const taxSplit = computeTax(discounted, pv.taxRateBps, pv.taxInclusive);
  return {
    lines,
    subtotal,
    discount,
    tax: taxSplit.tax,
    total: taxSplit.gross,
  };
}
