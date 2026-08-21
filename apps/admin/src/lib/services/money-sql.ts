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

/** The membership states that can still carry a collectable balance. */
export const LIVE_MEMBERSHIP_STATES = `('active','frozen','pending')`;
