-- ============================================================================
-- Hardening round from the production-readiness review:
--  1. Enforce staff_branch_access in RLS (branch-restricted staff really are
--     restricted; no rows in staff_branch_access = all branches, unchanged).
--  2. Close the auth_set_password scoping hole: members.edit may only target
--     member logins; staff/platform targets require staff.manage/self.
--  3. Database-level over-refund guard (defense in depth alongside the
--     service-layer row lock).
-- ============================================================================

-- ---- 1. Branch-level access enforcement ------------------------------------

CREATE OR REPLACE FUNCTION app.branch_allowed(p_branch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
           SELECT 1 FROM staff_branch_access WHERE user_id = app.current_user_id()
         )
      OR EXISTS (
           SELECT 1 FROM staff_branch_access
           WHERE user_id = app.current_user_id() AND branch_id = p_branch
         )
$$;
GRANT EXECUTE ON FUNCTION app.branch_allowed(uuid) TO gymflow_app;

-- Recreate the generated staff policies for branch-stamped tables with the
-- branch predicate added. (Tables without branch_id — events, freezes,
-- add-ons — inherit scoping through the member/membership joins used by the
-- application and stay tenant-scoped at the RLS layer.)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('members',          'members.view',     'members.create',    'members.edit'),
      ('memberships',      'members.view',     'memberships.sell',  'memberships.sell'),
      ('payments',         'payments.view',    'payments.record',   'payments.refund'),
      ('receipts',         'payments.view',    'payments.record',   NULL),
      ('attendance',       'attendance.view',  'attendance.checkin', NULL),
      ('leads',            'leads.view',       'leads.manage',      'leads.manage'),
      ('trainers',         'trainers.view',    'trainers.manage',   'trainers.manage'),
      ('trainer_sessions', 'pt.view',          'pt.manage',         'pt.manage')
    ) AS m(tbl, sel, ins, upd)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS staff_select ON %I', r.tbl);
    EXECUTE format(
      'CREATE POLICY staff_select ON %I FOR SELECT USING
         (app.is_active_staff() AND tenant_id = app.current_tenant_id()
          AND app.has_permission(%L) AND app.branch_allowed(branch_id))',
      r.tbl, r.sel);
    IF r.ins IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS staff_insert ON %I', r.tbl);
      EXECUTE format(
        'CREATE POLICY staff_insert ON %I FOR INSERT WITH CHECK
           (app.is_active_staff() AND tenant_id = app.current_tenant_id()
            AND app.has_permission(%L) AND app.branch_allowed(branch_id))',
        r.tbl, r.ins);
    END IF;
    IF r.upd IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS staff_update ON %I', r.tbl);
      EXECUTE format(
        'CREATE POLICY staff_update ON %I FOR UPDATE USING
           (app.is_active_staff() AND tenant_id = app.current_tenant_id()
            AND app.has_permission(%L) AND app.branch_allowed(branch_id))
         WITH CHECK (tenant_id = app.current_tenant_id() AND app.branch_allowed(branch_id))',
        r.tbl, r.upd);
    END IF;
  END LOOP;
END $$;

-- Lifecycle update policy on memberships also gains the branch predicate.
DROP POLICY IF EXISTS staff_update_lifecycle ON memberships;
CREATE POLICY staff_update_lifecycle ON memberships FOR UPDATE USING (
  app.is_active_staff() AND tenant_id = app.current_tenant_id()
  AND app.branch_allowed(branch_id)
  AND (app.has_permission('memberships.freeze')
    OR app.has_permission('memberships.cancel')
    OR app.has_permission('memberships.override'))
) WITH CHECK (tenant_id = app.current_tenant_id() AND app.branch_allowed(branch_id));

-- ---- 2. auth_set_password scoping ------------------------------------------
-- members.edit only reaches member logins; staff targets need staff.manage.
CREATE OR REPLACE FUNCTION app.auth_set_password(p_user uuid, p_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (
    p_user = app.current_user_id()
    OR app.is_platform_admin()
    OR (app.is_active_staff() AND app.has_permission('staff.manage')
        AND EXISTS (SELECT 1 FROM users u WHERE u.id = p_user
                    AND u.tenant_id = app.current_tenant_id()))
    OR (app.is_active_staff() AND app.has_permission('members.edit')
        AND EXISTS (SELECT 1 FROM users u WHERE u.id = p_user
                    AND u.tenant_id = app.current_tenant_id()
                    AND u.kind = 'member'))
  ) THEN
    RAISE EXCEPTION 'not authorized to set password' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO user_credentials (user_id, password_hash)
  VALUES (p_user, p_hash)
  ON CONFLICT (user_id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = now();
END $$;

-- ---- 3. Over-refund guard ---------------------------------------------------
-- Locks the payment row, so concurrent refund inserts serialize; total
-- refunds can never exceed the payment amount regardless of caller.
CREATE OR REPLACE FUNCTION app.refunds_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE paid bigint; already bigint;
BEGIN
  -- FOR UPDATE requires the caller to satisfy the payments UPDATE policy
  -- (payments.refund), so under-privileged staff fail here — before the
  -- refunds INSERT policy would reject them anyway.
  SELECT amount INTO paid FROM payments WHERE id = NEW.payment_id FOR UPDATE;
  IF paid IS NULL THEN
    RAISE EXCEPTION 'payment not found or not authorized for refund'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT coalesce(sum(amount), 0) INTO already FROM refunds WHERE payment_id = NEW.payment_id;
  IF already + NEW.amount > paid THEN
    RAISE EXCEPTION 'refund total (%) would exceed payment amount (%)', already + NEW.amount, paid
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER refunds_no_over_refund BEFORE INSERT ON refunds
  FOR EACH ROW EXECUTE FUNCTION app.refunds_guard();
