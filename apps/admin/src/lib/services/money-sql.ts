import 'server-only';

/**
 * One definition of "how much has actually been paid against a membership",
 * used by the member page, the members list, the dashboard dues tile and the
 * dues export — so those four can never disagree.
 *
 * Payments are immutable, so a correction is recorded as a refund; money that
 * came back therefore has to be taken off again. Correlates on the outer
 * `ms` alias, so every caller must expose the membership row as `ms`.
 */
export const PAID_AGAINST_MEMBERSHIP = `coalesce((
  SELECT sum(GREATEST(pa.amount - coalesce((
    SELECT sum(rf.amount) FROM refunds rf WHERE rf.payment_id = pa.payment_id
  ), 0), 0))
  FROM payment_allocations pa
  WHERE pa.membership_id = ms.id
), 0)`;

/** Outstanding balance on a membership, in paise. Never negative in practice. */
export const DUE_ON_MEMBERSHIP = `(ms.total_amount - ${PAID_AGAINST_MEMBERSHIP})`;

/**
 * The membership states that can still carry a collectable balance.
 *
 * 'expired' belongs here and its absence was a hole in the books: a member who
 * paid 2,000 of a 3,000 plan and then lapsed still owes 1,000, but the nightly
 * sweep moved the membership to 'expired' and the balance vanished from the
 * dashboard tile, the dues filter and the dues export on the same night. The
 * gym's receivables shrank without a rupee being collected, and the one member
 * most worth chasing became the one they could no longer see.
 *
 * 'cancelled' is deliberately NOT here: cancelling is the gym choosing to end
 * the agreement, and continuing to bill for it should be an explicit decision,
 * not a side effect. The payment history stays on the cancelled row either way.
 */
export const COLLECTABLE_MEMBERSHIP_STATES = `('active','frozen','pending','expired')`;

/**
 * Add-ons (PT packages, class passes) are sold with the same optional part
 * payment as memberships and were counted nowhere: no dues tile, no dues
 * export, no member screen. A gym selling PT on a deposit had receivables it
 * could not see at all.
 *
 * Correlates on the outer `ma` alias, mirroring PAID_AGAINST_MEMBERSHIP.
 */
export const PAID_AGAINST_ADDON = `coalesce((
  SELECT sum(GREATEST(pa.amount - coalesce((
    SELECT sum(rf.amount) FROM refunds rf WHERE rf.payment_id = pa.payment_id
  ), 0), 0))
  FROM payment_allocations pa
  WHERE pa.member_addon_id = ma.id
), 0)`;

/** Outstanding balance on an add-on, in paise. */
export const DUE_ON_ADDON = `(ma.price_snapshot - ${PAID_AGAINST_ADDON})`;

/** Add-on states that can still carry a collectable balance. */
export const COLLECTABLE_ADDON_STATES = `('active','expired')`;
