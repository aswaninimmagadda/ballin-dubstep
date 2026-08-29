-- ============================================================================
-- 0019 — reference integrity for tenant-scoped foreign keys
--
-- Two places where a row could be pointed at another gym's row. Neither is
-- reachable through the shipped UI, but RLS is the last line of defence in
-- this product and it was not holding these:
-- ============================================================================

-- 1. user_roles let a staff.manage user attach ANY role, including one owned
--    by another tenant. Both the USING and WITH CHECK constrained the target
--    user's tenant and said nothing about role_id, and app.has_permission()
--    honours whatever role is attached — so a foreign role's permissions
--    would have been granted verbatim.
ALTER POLICY user_roles_manage ON user_roles
  USING (
    (SELECT app.is_active_staff())
    AND (SELECT app.has_permission('staff.manage'))
    AND EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = user_id AND u.tenant_id = (SELECT app.current_tenant_id())
    )
    AND EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = role_id AND r.tenant_id = (SELECT app.current_tenant_id())
    )
  )
  WITH CHECK (
    (SELECT app.is_active_staff())
    AND (SELECT app.has_permission('staff.manage'))
    AND EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = user_id AND u.tenant_id = (SELECT app.current_tenant_id())
    )
    AND EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = role_id AND r.tenant_id = (SELECT app.current_tenant_id())
    )
  );

-- 2. members.branch_id and members.assigned_trainer_id are written straight
--    from a form. The RLS WITH CHECK requires the MEMBER's tenant to match and
--    the branch to be allowed to the actor, but never that the branch or the
--    trainer belongs to the same gym — a UUID from anywhere would be stored.
--    These are invariants, not permissions, so a trigger is the right place.
CREATE OR REPLACE FUNCTION app.members_guard_references()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.branch_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.branch_id IS DISTINCT FROM OLD.branch_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM branches b WHERE b.id = NEW.branch_id AND b.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'branch does not belong to this gym' USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  IF NEW.assigned_trainer_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.assigned_trainer_id IS DISTINCT FROM OLD.assigned_trainer_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM trainers tr WHERE tr.id = NEW.assigned_trainer_id AND tr.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'trainer does not belong to this gym' USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  IF NEW.referred_by_member_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.referred_by_member_id IS DISTINCT FROM OLD.referred_by_member_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM members m WHERE m.id = NEW.referred_by_member_id AND m.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'referring member does not belong to this gym'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS members_guard_references ON members;
CREATE TRIGGER members_guard_references
  BEFORE INSERT OR UPDATE OF branch_id, assigned_trainer_id, referred_by_member_id ON members
  FOR EACH ROW EXECUTE FUNCTION app.members_guard_references();
