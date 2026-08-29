-- ============================================================================
-- 0021 — a membership sold on the wrong plan or date can be corrected
--
-- `memberships.override` has existed in the permission list since the first
-- migration and the RLS policy has always honoured it; no service function and
-- no screen ever used it. A sale on the wrong plan or the wrong start date —
-- the most ordinary mistake at a busy desk — therefore had no fix at all. The
-- only tool was to cancel and re-sell, which strands the payment on the
-- cancelled row: cancelMembership does not touch payment_allocations, so the
-- money stays attached to a membership nobody is counting and the member shows
-- as owing the full amount again.
--
-- 'corrected' joins the membership_events vocabulary so the change is visible
-- in the member's timeline rather than only in the audit log.
-- ============================================================================

ALTER TABLE membership_events DROP CONSTRAINT IF EXISTS membership_events_type_check;
ALTER TABLE membership_events ADD CONSTRAINT membership_events_type_check
  CHECK (type = ANY (ARRAY[
    'sold', 'activated', 'renewed', 'frozen', 'unfrozen',
    'cancelled', 'expired', 'extended', 'transferred', 'corrected'
  ]));
