-- A member may legitimately hold ONE running membership (active/frozen) plus
-- ONE future-dated renewal (pending) at the same time. The original single
-- "one live" index rejected early renewals; split it into two invariants.
DROP INDEX IF EXISTS memberships_one_live_per_member;

CREATE UNIQUE INDEX memberships_one_running_per_member ON memberships(member_id)
  WHERE state IN ('active', 'frozen');

CREATE UNIQUE INDEX memberships_one_pending_per_member ON memberships(member_id)
  WHERE state = 'pending';
