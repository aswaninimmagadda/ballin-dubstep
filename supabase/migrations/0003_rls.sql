-- ============================================================================
-- Row Level Security. Tenant isolation is enforced HERE, in the database —
-- never by UI filtering. The application role (gymflow_app) is subject to
-- these policies; only migrations run as the owner.
--
-- Three principals, identified by per-transaction claims (see 0002):
--   * platform_admin — cross-tenant platform operations
--   * staff          — rows of their tenant, gated by granular permissions
--   * member         — strictly their own rows
-- ============================================================================

-- Auth-path tables are reachable ONLY through SECURITY DEFINER functions
-- (defined in 0004): no direct table access for the app role at all.
REVOKE ALL ON user_credentials, sessions, refresh_tokens, login_attempts,
  receipt_sequences FROM gymflow_app;

-- Enable RLS everywhere. The runtime role (gymflow_app) is never the table
-- owner, so every application query is subject to these policies; only
-- migrations/seeds run as the owner.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants','brands','branches','users','user_credentials','sessions',
    'refresh_tokens','login_attempts','roles','role_permissions','user_roles',
    'staff_branch_access','trainers','members','member_status_history',
    'membership_plans','membership_plan_versions','addon_packages','memberships',
    'membership_events','membership_freezes','member_addons','trainer_sessions',
    'leads','lead_activities','promotions','promotion_redemptions','payments',
    'payment_allocations','refunds','receipt_sequences','receipts','attendance',
    'notification_templates','notification_deliveries','gym_settings',
    'feature_flags','audit_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- Platform admin: full access on every table (platform operations).
-- ----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants','brands','branches','users','roles','role_permissions','user_roles',
    'staff_branch_access','trainers','members','member_status_history',
    'membership_plans','membership_plan_versions','addon_packages','memberships',
    'membership_events','membership_freezes','member_addons','trainer_sessions',
    'leads','lead_activities','promotions','promotion_redemptions','payments',
    'payment_allocations','refunds','receipts','attendance',
    'notification_templates','notification_deliveries','gym_settings',
    'feature_flags','audit_logs'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY platform_all ON %I FOR ALL USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin())',
      t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- Staff: standard tenant-scoped policies, generated from a permission map.
-- SELECT requires the "view" permission; writes require specific permissions.
-- Every policy repeats the tenant_id check — a permission never crosses
-- tenants.
-- ----------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- table,                select_perm,        insert_perm,        update_perm,          allow_delete
      ('members',             'members.view',     'members.create',   'members.edit',       false),
      ('member_status_history','members.view',    'members.edit',     NULL,                 false),
      ('trainers',            'trainers.view',    'trainers.manage',  'trainers.manage',    false),
      ('membership_plans',    'plans.view',       'plans.manage',     'plans.manage',       false),
      ('membership_plan_versions','plans.view',   'plans.manage',     NULL,                 false),
      ('addon_packages',      'plans.view',       'plans.manage',     'plans.manage',       false),
      ('memberships',         'members.view',     'memberships.sell', 'memberships.sell',   false),
      ('membership_events',   'members.view',     'memberships.sell', NULL,                 false),
      ('membership_freezes',  'members.view',     'memberships.freeze','memberships.freeze', false),
      ('member_addons',       'pt.view',          'pt.manage',        'pt.manage',          false),
      ('trainer_sessions',    'pt.view',          'pt.manage',        'pt.manage',          false),
      ('leads',               'leads.view',       'leads.manage',     'leads.manage',       false),
      ('lead_activities',     'leads.view',       'leads.manage',     NULL,                 false),
      ('promotions',          'promotions.view',  'promotions.manage','promotions.manage',  false),
      ('promotion_redemptions','promotions.view', 'memberships.sell', NULL,                 false),
      ('payments',            'payments.view',    'payments.record',  'payments.refund',    false),
      ('payment_allocations', 'payments.view',    'payments.record',  NULL,                 false),
      ('refunds',             'payments.view',    'payments.refund',  NULL,                 false),
      ('receipts',            'payments.view',    'payments.record',  NULL,                 false),
      ('attendance',          'attendance.view',  'attendance.checkin', NULL,               false),
      ('notification_templates','settings.view',  'notifications.manage','notifications.manage', false),
      ('notification_deliveries','members.view',  'members.view',     NULL,                 false)
    ) AS m(tbl, sel, ins, upd, del)
  LOOP
    EXECUTE format(
      'CREATE POLICY staff_select ON %I FOR SELECT USING
         (app.is_active_staff() AND tenant_id = app.current_tenant_id() AND app.has_permission(%L))',
      r.tbl, r.sel);
    IF r.ins IS NOT NULL THEN
      EXECUTE format(
        'CREATE POLICY staff_insert ON %I FOR INSERT WITH CHECK
           (app.is_active_staff() AND tenant_id = app.current_tenant_id() AND app.has_permission(%L))',
        r.tbl, r.ins);
    END IF;
    IF r.upd IS NOT NULL THEN
      EXECUTE format(
        'CREATE POLICY staff_update ON %I FOR UPDATE USING
           (app.is_active_staff() AND tenant_id = app.current_tenant_id() AND app.has_permission(%L))
         WITH CHECK (tenant_id = app.current_tenant_id())',
        r.tbl, r.upd);
    END IF;
  END LOOP;
END $$;

-- Memberships also need freeze/cancel/override updates by staff who lack the
-- sell permission (e.g. a manager-only cancel flow).
CREATE POLICY staff_update_lifecycle ON memberships FOR UPDATE USING (
  app.is_active_staff() AND tenant_id = app.current_tenant_id()
  AND (app.has_permission('memberships.freeze')
    OR app.has_permission('memberships.cancel')
    OR app.has_permission('memberships.override'))
) WITH CHECK (tenant_id = app.current_tenant_id());

-- Membership events may also be written while freezing/cancelling.
CREATE POLICY staff_insert_lifecycle ON membership_events FOR INSERT WITH CHECK (
  app.is_active_staff() AND tenant_id = app.current_tenant_id()
  AND (app.has_permission('memberships.freeze')
    OR app.has_permission('memberships.cancel')
    OR app.has_permission('memberships.renew'))
);

-- ----------------------------------------------------------------------------
-- Tenant metadata visible to all authenticated principals of that tenant
-- ----------------------------------------------------------------------------

CREATE POLICY tenant_read ON tenants FOR SELECT USING (
  id = app.current_tenant_id()
);
CREATE POLICY brand_read ON brands FOR SELECT USING (
  tenant_id = app.current_tenant_id()
);
CREATE POLICY branch_read ON branches FOR SELECT USING (
  tenant_id = app.current_tenant_id()
);
CREATE POLICY brand_manage ON brands FOR ALL USING (
  app.is_active_staff() AND tenant_id = app.current_tenant_id() AND app.has_permission('settings.manage')
) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY branch_manage ON branches FOR ALL USING (
  app.is_active_staff() AND tenant_id = app.current_tenant_id() AND app.has_permission('settings.manage')
) WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY settings_read ON gym_settings FOR SELECT USING (
  app.is_active_staff() AND tenant_id = app.current_tenant_id()
);
CREATE POLICY settings_manage ON gym_settings FOR UPDATE USING (
  app.is_active_staff() AND tenant_id = app.current_tenant_id() AND app.has_permission('settings.manage')
) WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY flags_read ON feature_flags FOR SELECT USING (
  tenant_id = app.current_tenant_id()
);

-- ----------------------------------------------------------------------------
-- Users & RBAC
-- ----------------------------------------------------------------------------

-- Anyone can read their own user row; staff can read tenant users; staff
-- management requires staff.manage.
CREATE POLICY user_self_read ON users FOR SELECT USING (id = app.current_user_id());
CREATE POLICY user_self_update ON users FOR UPDATE USING (id = app.current_user_id())
  WITH CHECK (id = app.current_user_id());
CREATE POLICY user_staff_read ON users FOR SELECT USING (
  app.is_active_staff() AND tenant_id = app.current_tenant_id()
);
CREATE POLICY user_staff_manage ON users FOR ALL USING (
  app.is_active_staff() AND tenant_id = app.current_tenant_id() AND app.has_permission('staff.manage')
) WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY roles_read ON roles FOR SELECT USING (
  tenant_id IS NULL OR (app.is_active_staff() AND tenant_id = app.current_tenant_id())
);
CREATE POLICY roles_manage ON roles FOR ALL USING (
  app.is_active_staff() AND tenant_id = app.current_tenant_id() AND app.has_permission('staff.manage')
) WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY role_perms_read ON role_permissions FOR SELECT USING (
  EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id
          AND (r.tenant_id IS NULL OR (app.is_active_staff() AND r.tenant_id = app.current_tenant_id())))
);
CREATE POLICY role_perms_manage ON role_permissions FOR ALL USING (
  app.is_active_staff() AND app.has_permission('staff.manage')
  AND EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id AND r.tenant_id = app.current_tenant_id())
) WITH CHECK (
  EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id AND r.tenant_id = app.current_tenant_id())
);

CREATE POLICY user_roles_read ON user_roles FOR SELECT USING (
  user_id = app.current_user_id()
  OR (app.is_active_staff() AND EXISTS (
        SELECT 1 FROM users u WHERE u.id = user_id AND u.tenant_id = app.current_tenant_id()))
);
CREATE POLICY user_roles_manage ON user_roles FOR ALL USING (
  app.is_active_staff() AND app.has_permission('staff.manage')
  AND EXISTS (SELECT 1 FROM users u WHERE u.id = user_id AND u.tenant_id = app.current_tenant_id())
) WITH CHECK (
  EXISTS (SELECT 1 FROM users u WHERE u.id = user_id AND u.tenant_id = app.current_tenant_id())
);

CREATE POLICY sba_read ON staff_branch_access FOR SELECT USING (
  user_id = app.current_user_id()
  OR (app.is_active_staff() AND EXISTS (
        SELECT 1 FROM users u WHERE u.id = user_id AND u.tenant_id = app.current_tenant_id()))
);
CREATE POLICY sba_manage ON staff_branch_access FOR ALL USING (
  app.is_active_staff() AND app.has_permission('staff.manage')
  AND EXISTS (SELECT 1 FROM users u WHERE u.id = user_id AND u.tenant_id = app.current_tenant_id())
) WITH CHECK (
  EXISTS (SELECT 1 FROM users u WHERE u.id = user_id AND u.tenant_id = app.current_tenant_id())
);

-- ----------------------------------------------------------------------------
-- Member self-access (member mobile app)
-- ----------------------------------------------------------------------------

CREATE POLICY member_self ON members FOR SELECT USING (
  app.current_kind() = 'member' AND user_id = app.current_user_id()
    AND tenant_id = app.current_tenant_id()
);
CREATE POLICY member_own_memberships ON memberships FOR SELECT USING (
  app.current_kind() = 'member' AND member_id = app.current_member_id()
);
CREATE POLICY member_own_freezes ON membership_freezes FOR SELECT USING (
  app.current_kind() = 'member' AND EXISTS (
    SELECT 1 FROM memberships m WHERE m.id = membership_id AND m.member_id = app.current_member_id())
);
CREATE POLICY member_own_addons ON member_addons FOR SELECT USING (
  app.current_kind() = 'member' AND member_id = app.current_member_id()
);
CREATE POLICY member_own_sessions ON trainer_sessions FOR SELECT USING (
  app.current_kind() = 'member' AND member_id = app.current_member_id()
);
CREATE POLICY member_own_payments ON payments FOR SELECT USING (
  app.current_kind() = 'member' AND member_id = app.current_member_id()
);
CREATE POLICY member_own_receipts ON receipts FOR SELECT USING (
  app.current_kind() = 'member' AND EXISTS (
    SELECT 1 FROM payments p WHERE p.id = payment_id AND p.member_id = app.current_member_id())
);
CREATE POLICY member_own_attendance ON attendance FOR SELECT USING (
  app.current_kind() = 'member' AND member_id = app.current_member_id()
);
CREATE POLICY member_own_notifications ON notification_deliveries FOR SELECT USING (
  app.current_kind() = 'member' AND member_id = app.current_member_id()
);
CREATE POLICY member_active_plans ON membership_plans FOR SELECT USING (
  app.current_kind() = 'member' AND tenant_id = app.current_tenant_id() AND is_active
);
CREATE POLICY member_active_promotions ON promotions FOR SELECT USING (
  app.current_kind() = 'member' AND tenant_id = app.current_tenant_id()
    AND is_active AND CURRENT_DATE BETWEEN valid_from AND valid_to
);

-- Members see trainers only through this restricted view (no mobile number).
CREATE VIEW trainer_public AS
  SELECT id, tenant_id, branch_id, name, photo_path, specialization, is_active
  FROM trainers
  WHERE tenant_id = app.current_tenant_id();
GRANT SELECT ON trainer_public TO gymflow_app;

-- ----------------------------------------------------------------------------
-- Audit log: append-only for staff, readable with audit.view
-- ----------------------------------------------------------------------------

CREATE POLICY audit_insert ON audit_logs FOR INSERT WITH CHECK (
  (app.is_active_staff() AND tenant_id = app.current_tenant_id())
  OR app.is_platform_admin()
);
CREATE POLICY audit_read ON audit_logs FOR SELECT USING (
  app.is_active_staff() AND tenant_id = app.current_tenant_id() AND app.has_permission('audit.view')
);
