-- ============================================================================
-- 0022 — a platform admin has to be *in* a gym before they can work in one.
--
-- Until now `platform_all` was `USING (app.is_platform_admin())` on every
-- table, unqualified. A platform admin who opened /members saw every gym's
-- members in one list, sorted together, with nothing on the row saying which
-- gym a name belonged to — and every action on those screens (take a payment,
-- edit a member, sell a membership) was live. Support could take cash against
-- the wrong gym's member and neither the screen nor the receipt would ever
-- have said so.
--
-- The fix is a scope. A platform admin's claims carry `tenant_id` NULL while
-- they are on the platform console, and the id of the gym they have entered
-- once they pick one. `platform_all` now honours it, so the scope is a
-- database boundary and not a WHERE clause the UI could forget: while a
-- platform admin is inside Gym A, Gym B's rows are not merely hidden from the
-- list, they are unreadable and unwritable.
--
-- Unscoped (tenant_id NULL) still means full cross-tenant access — that is
-- what the platform console and the operator CLI need.
-- ============================================================================

-- The 28 tables that carry tenant_id directly.
DO $$
DECLARE t text;
DECLARE pred text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'brands','branches','roles','trainers','members','member_status_history',
    'membership_plans','membership_plan_versions','addon_packages','memberships',
    'membership_events','membership_freezes','member_addons','trainer_sessions',
    'leads','lead_activities','promotions','promotion_redemptions','payments',
    'payment_allocations','refunds','receipts','attendance',
    'notification_templates','notification_deliveries','gym_settings',
    'feature_flags','audit_logs'
  ] LOOP
    -- The helpers are wrapped in scalar subqueries so the planner evaluates
    -- them once per statement as an InitPlan, the way 0014 established.
    pred := '(SELECT app.is_platform_admin()) AND ('
         || '(SELECT app.current_tenant_id()) IS NULL'
         || ' OR ' || quote_ident(t) || '.tenant_id = (SELECT app.current_tenant_id()))';
    EXECUTE format('ALTER POLICY platform_all ON %I USING (%s) WITH CHECK (%s)', t, pred, pred);
  END LOOP;
END $$;

-- tenants: the scoped gym is the only one they can see or change.
ALTER POLICY platform_all ON tenants
  USING ((SELECT app.is_platform_admin())
     AND ((SELECT app.current_tenant_id()) IS NULL OR tenants.id = (SELECT app.current_tenant_id())))
  WITH CHECK ((SELECT app.is_platform_admin())
     AND ((SELECT app.current_tenant_id()) IS NULL OR tenants.id = (SELECT app.current_tenant_id())));

-- users: the gym's users, plus always their own row — a scoped platform admin
-- has no tenant of their own and must not read themselves out of existence.
ALTER POLICY platform_all ON users
  USING ((SELECT app.is_platform_admin())
     AND ((SELECT app.current_tenant_id()) IS NULL
          OR users.tenant_id = (SELECT app.current_tenant_id())
          OR users.id = (SELECT app.current_user_id())))
  WITH CHECK ((SELECT app.is_platform_admin())
     AND ((SELECT app.current_tenant_id()) IS NULL
          OR users.tenant_id = (SELECT app.current_tenant_id())
          OR users.id = (SELECT app.current_user_id())));

-- The three join tables carry no tenant_id; they inherit it from their parent.
ALTER POLICY platform_all ON role_permissions
  USING ((SELECT app.is_platform_admin())
     AND ((SELECT app.current_tenant_id()) IS NULL
          OR EXISTS (SELECT 1 FROM roles r
                      WHERE r.id = role_permissions.role_id
                        AND r.tenant_id = (SELECT app.current_tenant_id()))))
  WITH CHECK ((SELECT app.is_platform_admin())
     AND ((SELECT app.current_tenant_id()) IS NULL
          OR EXISTS (SELECT 1 FROM roles r
                      WHERE r.id = role_permissions.role_id
                        AND r.tenant_id = (SELECT app.current_tenant_id()))));

ALTER POLICY platform_all ON user_roles
  USING ((SELECT app.is_platform_admin())
     AND ((SELECT app.current_tenant_id()) IS NULL
          OR EXISTS (SELECT 1 FROM users u
                      WHERE u.id = user_roles.user_id
                        AND u.tenant_id = (SELECT app.current_tenant_id()))))
  WITH CHECK ((SELECT app.is_platform_admin())
     AND ((SELECT app.current_tenant_id()) IS NULL
          OR EXISTS (SELECT 1 FROM users u
                      WHERE u.id = user_roles.user_id
                        AND u.tenant_id = (SELECT app.current_tenant_id()))));

ALTER POLICY platform_all ON staff_branch_access
  USING ((SELECT app.is_platform_admin())
     AND ((SELECT app.current_tenant_id()) IS NULL
          OR EXISTS (SELECT 1 FROM users u
                      WHERE u.id = staff_branch_access.user_id
                        AND u.tenant_id = (SELECT app.current_tenant_id()))))
  WITH CHECK ((SELECT app.is_platform_admin())
     AND ((SELECT app.current_tenant_id()) IS NULL
          OR EXISTS (SELECT 1 FROM users u
                      WHERE u.id = staff_branch_access.user_id
                        AND u.tenant_id = (SELECT app.current_tenant_id()))));

-- ----------------------------------------------------------------------------
-- Guard: every platform_all policy must honour the scope, in BOTH halves.
-- PostgreSQL ORs the USING and WITH CHECK expressions of permissive policies
-- separately, so a WITH CHECK that forgot the scope would let a scoped admin
-- write rows into a gym they cannot read.
-- ----------------------------------------------------------------------------
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(c.relname || ' (' || half || ')', ', ' ORDER BY c.relname)
    INTO bad
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  CROSS JOIN LATERAL (VALUES
    ('using', pg_get_expr(p.polqual, p.polrelid)),
    ('with check', pg_get_expr(p.polwithcheck, p.polrelid))
  ) AS h(half, expr)
  WHERE p.polname = 'platform_all'
    AND (h.expr IS NULL OR h.expr NOT LIKE '%current_tenant_id%');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'platform_all ignores the tenant scope on: %', bad;
  END IF;
END $$;
