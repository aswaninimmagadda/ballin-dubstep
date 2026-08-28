-- ============================================================================
-- 0014 — RLS predicate hoisting (performance only; no change to who sees what)
--
-- Every policy predicate called app.is_active_staff() / has_permission() /
-- current_tenant_id() / ... directly. Those are STABLE SECURITY DEFINER
-- functions that each run an EXISTS against users / user_roles /
-- role_permissions, and PostgreSQL evaluates them ONCE PER ROW inside a
-- policy qual. On a 5,000-member gym that is ~20,000 extra index lookups for
-- a single member-list load.
--
-- Wrapping a call that does not depend on the row in a scalar subquery —
-- app.f()  ->  (SELECT app.f()) — makes the planner turn it into an InitPlan,
-- evaluated exactly once per query. This is a pure planner-level change: a
-- scalar subquery over a one-row expression is semantically identical to the
-- expression, NULLs included.
--
-- Measured on a 5,000-member tenant (see docs/PERFORMANCE.md):
--   SELECT count(*) FROM members   758 ms -> 25 ms   (30x)
--   members search (ILIKE)         409 ms -> 32 ms   (13x)
--
-- app.branch_allowed(branch_id) is deliberately NOT wrapped: its argument is
-- a column, so it cannot be hoisted, and wrapping it only adds SubPlan
-- overhead (measured 28.5 ms vs 24.7 ms).
--
-- The statements below were generated from pg_policy and each one was checked
-- by mechanically stripping the (SELECT ...) wrappers back out and asserting
-- the result is byte-identical to the predicate it replaces.
-- ============================================================================

ALTER POLICY platform_all ON addon_packages
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY staff_insert ON addon_packages
  WITH CHECK (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('plans.manage'::text))));

ALTER POLICY staff_select ON addon_packages
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('plans.view'::text))));

ALTER POLICY staff_update ON addon_packages
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('plans.manage'::text))))
  WITH CHECK ((tenant_id = (SELECT app.current_tenant_id())));

ALTER POLICY member_own_attendance ON attendance
  USING ((((SELECT app.current_kind()) = 'member'::text) AND (member_id = (SELECT app.current_member_id()))));

ALTER POLICY platform_all ON attendance
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY staff_insert ON attendance
  WITH CHECK (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('attendance.checkin'::text)) AND app.branch_allowed(branch_id)));

ALTER POLICY staff_select ON attendance
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('attendance.view'::text)) AND app.branch_allowed(branch_id)));

ALTER POLICY audit_insert ON audit_logs
  WITH CHECK ((((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id()))) OR (SELECT app.is_platform_admin())));

ALTER POLICY audit_read ON audit_logs
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('audit.view'::text))));

ALTER POLICY platform_all ON audit_logs
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY branch_manage ON branches
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('settings.manage'::text))))
  WITH CHECK ((tenant_id = (SELECT app.current_tenant_id())));

ALTER POLICY branch_read ON branches
  USING ((tenant_id = (SELECT app.current_tenant_id())));

ALTER POLICY platform_all ON branches
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY brand_manage ON brands
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('settings.manage'::text))))
  WITH CHECK ((tenant_id = (SELECT app.current_tenant_id())));

ALTER POLICY brand_read ON brands
  USING ((tenant_id = (SELECT app.current_tenant_id())));

ALTER POLICY platform_all ON brands
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY stash_staff ON csv_import_stash
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('import.run'::text))))
  WITH CHECK (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('import.run'::text))));

ALTER POLICY flags_read ON feature_flags
  USING ((tenant_id = (SELECT app.current_tenant_id())));

ALTER POLICY platform_all ON feature_flags
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY platform_all ON gym_settings
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY settings_manage ON gym_settings
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('settings.manage'::text))))
  WITH CHECK ((tenant_id = (SELECT app.current_tenant_id())));

ALTER POLICY settings_read ON gym_settings
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id()))));

ALTER POLICY platform_all ON lead_activities
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY staff_insert ON lead_activities
  WITH CHECK (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('leads.manage'::text))));

ALTER POLICY staff_select ON lead_activities
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('leads.view'::text))));

ALTER POLICY platform_all ON leads
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY staff_insert ON leads
  WITH CHECK (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('leads.manage'::text)) AND app.branch_allowed(branch_id)));

ALTER POLICY staff_select ON leads
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('leads.view'::text)) AND app.branch_allowed(branch_id)));

ALTER POLICY staff_update ON leads
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('leads.manage'::text)) AND app.branch_allowed(branch_id)))
  WITH CHECK (((tenant_id = (SELECT app.current_tenant_id())) AND app.branch_allowed(branch_id)));

ALTER POLICY member_own_addons ON member_addons
  USING ((((SELECT app.current_kind()) = 'member'::text) AND (member_id = (SELECT app.current_member_id()))));

ALTER POLICY platform_all ON member_addons
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY staff_insert ON member_addons
  WITH CHECK (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('pt.manage'::text))));

ALTER POLICY staff_select ON member_addons
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('pt.view'::text))));

ALTER POLICY staff_update ON member_addons
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('pt.manage'::text))))
  WITH CHECK ((tenant_id = (SELECT app.current_tenant_id())));

ALTER POLICY deletion_req_member_select ON member_deletion_requests
  USING ((member_id = (SELECT app.current_member_id())));

ALTER POLICY deletion_req_staff_select ON member_deletion_requests
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('members.view'::text))));

ALTER POLICY deletion_req_staff_update ON member_deletion_requests
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('members.edit'::text))))
  WITH CHECK ((tenant_id = (SELECT app.current_tenant_id())));

ALTER POLICY platform_all ON member_status_history
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY staff_insert ON member_status_history
  WITH CHECK (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('members.edit'::text))));

ALTER POLICY staff_select ON member_status_history
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('members.view'::text))));

ALTER POLICY member_self ON members
  USING ((((SELECT app.current_kind()) = 'member'::text) AND (user_id = (SELECT app.current_user_id())) AND (tenant_id = (SELECT app.current_tenant_id()))));

ALTER POLICY platform_all ON members
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY staff_insert ON members
  WITH CHECK (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('members.create'::text)) AND app.branch_allowed(branch_id)));

ALTER POLICY staff_select ON members
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('members.view'::text)) AND app.branch_allowed(branch_id)));

ALTER POLICY staff_update ON members
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('members.edit'::text)) AND app.branch_allowed(branch_id)))
  WITH CHECK (((tenant_id = (SELECT app.current_tenant_id())) AND app.branch_allowed(branch_id)));

ALTER POLICY platform_all ON membership_events
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY staff_insert ON membership_events
  WITH CHECK (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('memberships.sell'::text))));

ALTER POLICY staff_insert_lifecycle ON membership_events
  WITH CHECK (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND ((SELECT app.has_permission('memberships.freeze'::text)) OR (SELECT app.has_permission('memberships.cancel'::text)) OR (SELECT app.has_permission('memberships.renew'::text)))));

ALTER POLICY staff_select ON membership_events
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('members.view'::text))));

ALTER POLICY member_own_freezes ON membership_freezes
  USING ((((SELECT app.current_kind()) = 'member'::text) AND (EXISTS ( SELECT 1 FROM memberships m WHERE ((m.id = membership_freezes.membership_id) AND (m.member_id = (SELECT app.current_member_id())))))));

ALTER POLICY platform_all ON membership_freezes
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY staff_insert ON membership_freezes
  WITH CHECK (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('memberships.freeze'::text))));

ALTER POLICY staff_select ON membership_freezes
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('members.view'::text))));

ALTER POLICY staff_update ON membership_freezes
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('memberships.freeze'::text))))
  WITH CHECK ((tenant_id = (SELECT app.current_tenant_id())));

ALTER POLICY platform_all ON membership_plan_versions
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY staff_insert ON membership_plan_versions
  WITH CHECK (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('plans.manage'::text))));

ALTER POLICY staff_select ON membership_plan_versions
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('plans.view'::text))));

ALTER POLICY member_active_plans ON membership_plans
  USING ((((SELECT app.current_kind()) = 'member'::text) AND (tenant_id = (SELECT app.current_tenant_id())) AND is_active));

ALTER POLICY platform_all ON membership_plans
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY staff_insert ON membership_plans
  WITH CHECK (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('plans.manage'::text))));

ALTER POLICY staff_select ON membership_plans
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('plans.view'::text))));

ALTER POLICY staff_update ON membership_plans
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('plans.manage'::text))))
  WITH CHECK ((tenant_id = (SELECT app.current_tenant_id())));

ALTER POLICY member_own_memberships ON memberships
  USING ((((SELECT app.current_kind()) = 'member'::text) AND (member_id = (SELECT app.current_member_id()))));

ALTER POLICY platform_all ON memberships
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY staff_insert ON memberships
  WITH CHECK (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('memberships.sell'::text)) AND app.branch_allowed(branch_id)));

ALTER POLICY staff_select ON memberships
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('members.view'::text)) AND app.branch_allowed(branch_id)));

ALTER POLICY staff_update ON memberships
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('memberships.sell'::text)) AND app.branch_allowed(branch_id)))
  WITH CHECK (((tenant_id = (SELECT app.current_tenant_id())) AND app.branch_allowed(branch_id)));

ALTER POLICY staff_update_lifecycle ON memberships
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND app.branch_allowed(branch_id) AND ((SELECT app.has_permission('memberships.freeze'::text)) OR (SELECT app.has_permission('memberships.cancel'::text)) OR (SELECT app.has_permission('memberships.override'::text)))))
  WITH CHECK (((tenant_id = (SELECT app.current_tenant_id())) AND app.branch_allowed(branch_id)));

ALTER POLICY member_own_notifications ON notification_deliveries
  USING ((((SELECT app.current_kind()) = 'member'::text) AND (member_id = (SELECT app.current_member_id()))));

ALTER POLICY platform_all ON notification_deliveries
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY staff_insert ON notification_deliveries
  WITH CHECK (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('members.view'::text))));

ALTER POLICY staff_select ON notification_deliveries
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('members.view'::text))));

ALTER POLICY platform_all ON notification_templates
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY staff_insert ON notification_templates
  WITH CHECK (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('notifications.manage'::text))));

ALTER POLICY staff_select ON notification_templates
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('settings.view'::text))));

ALTER POLICY staff_update ON notification_templates
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('notifications.manage'::text))))
  WITH CHECK ((tenant_id = (SELECT app.current_tenant_id())));

ALTER POLICY platform_all ON payment_allocations
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY staff_insert ON payment_allocations
  WITH CHECK (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('payments.record'::text))));

ALTER POLICY staff_select ON payment_allocations
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('payments.view'::text))));

ALTER POLICY member_own_payments ON payments
  USING ((((SELECT app.current_kind()) = 'member'::text) AND (member_id = (SELECT app.current_member_id()))));

ALTER POLICY platform_all ON payments
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY staff_insert ON payments
  WITH CHECK (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('payments.record'::text)) AND app.branch_allowed(branch_id)));

ALTER POLICY staff_select ON payments
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('payments.view'::text)) AND app.branch_allowed(branch_id)));

ALTER POLICY staff_update ON payments
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('payments.refund'::text)) AND app.branch_allowed(branch_id)))
  WITH CHECK (((tenant_id = (SELECT app.current_tenant_id())) AND app.branch_allowed(branch_id)));

ALTER POLICY platform_all ON promotion_redemptions
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY staff_insert ON promotion_redemptions
  WITH CHECK (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('memberships.sell'::text))));

ALTER POLICY staff_select ON promotion_redemptions
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('promotions.view'::text))));

ALTER POLICY member_active_promotions ON promotions
  USING ((((SELECT app.current_kind()) = 'member'::text) AND (tenant_id = (SELECT app.current_tenant_id())) AND is_active AND ((CURRENT_DATE >= valid_from) AND (CURRENT_DATE <= valid_to))));

ALTER POLICY platform_all ON promotions
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY staff_insert ON promotions
  WITH CHECK (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('promotions.manage'::text))));

ALTER POLICY staff_select ON promotions
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('promotions.view'::text))));

ALTER POLICY staff_update ON promotions
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('promotions.manage'::text))))
  WITH CHECK ((tenant_id = (SELECT app.current_tenant_id())));

ALTER POLICY member_own_receipts ON receipts
  USING ((((SELECT app.current_kind()) = 'member'::text) AND (EXISTS ( SELECT 1 FROM payments p WHERE ((p.id = receipts.payment_id) AND (p.member_id = (SELECT app.current_member_id())))))));

ALTER POLICY platform_all ON receipts
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY staff_insert ON receipts
  WITH CHECK (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('payments.record'::text)) AND app.branch_allowed(branch_id)));

ALTER POLICY staff_select ON receipts
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('payments.view'::text)) AND app.branch_allowed(branch_id)));

ALTER POLICY platform_all ON refunds
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY staff_insert ON refunds
  WITH CHECK (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('payments.refund'::text))));

ALTER POLICY staff_select ON refunds
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('payments.view'::text))));

ALTER POLICY platform_all ON role_permissions
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY role_perms_manage ON role_permissions
  USING (((SELECT app.is_active_staff()) AND (SELECT app.has_permission('staff.manage'::text)) AND (EXISTS ( SELECT 1 FROM roles r WHERE ((r.id = role_permissions.role_id) AND (r.tenant_id = (SELECT app.current_tenant_id())))))))
  WITH CHECK ((EXISTS ( SELECT 1 FROM roles r WHERE ((r.id = role_permissions.role_id) AND (r.tenant_id = (SELECT app.current_tenant_id()))))));

ALTER POLICY role_perms_read ON role_permissions
  USING ((EXISTS ( SELECT 1 FROM roles r WHERE ((r.id = role_permissions.role_id) AND ((r.tenant_id IS NULL) OR ((SELECT app.is_active_staff()) AND (r.tenant_id = (SELECT app.current_tenant_id()))))))));

ALTER POLICY platform_all ON roles
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY roles_manage ON roles
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('staff.manage'::text))))
  WITH CHECK ((tenant_id = (SELECT app.current_tenant_id())));

ALTER POLICY roles_read ON roles
  USING (((tenant_id IS NULL) OR ((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())))));

ALTER POLICY platform_all ON staff_branch_access
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY sba_manage ON staff_branch_access
  USING (((SELECT app.is_active_staff()) AND (SELECT app.has_permission('staff.manage'::text)) AND (EXISTS ( SELECT 1 FROM users u WHERE ((u.id = staff_branch_access.user_id) AND (u.tenant_id = (SELECT app.current_tenant_id())))))))
  WITH CHECK ((EXISTS ( SELECT 1 FROM users u WHERE ((u.id = staff_branch_access.user_id) AND (u.tenant_id = (SELECT app.current_tenant_id()))))));

ALTER POLICY sba_read ON staff_branch_access
  USING (((user_id = (SELECT app.current_user_id())) OR ((SELECT app.is_active_staff()) AND (EXISTS ( SELECT 1 FROM users u WHERE ((u.id = staff_branch_access.user_id) AND (u.tenant_id = (SELECT app.current_tenant_id()))))))));

ALTER POLICY platform_all ON tenants
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY tenant_read ON tenants
  USING ((id = (SELECT app.current_tenant_id())));

ALTER POLICY member_own_sessions ON trainer_sessions
  USING ((((SELECT app.current_kind()) = 'member'::text) AND (member_id = (SELECT app.current_member_id()))));

ALTER POLICY platform_all ON trainer_sessions
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY staff_insert ON trainer_sessions
  WITH CHECK (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('pt.manage'::text)) AND app.branch_allowed(branch_id)));

ALTER POLICY staff_select ON trainer_sessions
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('pt.view'::text)) AND app.branch_allowed(branch_id)));

ALTER POLICY staff_update ON trainer_sessions
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('pt.manage'::text)) AND app.branch_allowed(branch_id)))
  WITH CHECK (((tenant_id = (SELECT app.current_tenant_id())) AND app.branch_allowed(branch_id)));

ALTER POLICY platform_all ON trainers
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY staff_insert ON trainers
  WITH CHECK (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('trainers.manage'::text)) AND app.branch_allowed(branch_id)));

ALTER POLICY staff_select ON trainers
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('trainers.view'::text)) AND app.branch_allowed(branch_id)));

ALTER POLICY staff_update ON trainers
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('trainers.manage'::text)) AND app.branch_allowed(branch_id)))
  WITH CHECK (((tenant_id = (SELECT app.current_tenant_id())) AND app.branch_allowed(branch_id)));

ALTER POLICY platform_all ON user_roles
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY user_roles_manage ON user_roles
  USING (((SELECT app.is_active_staff()) AND (SELECT app.has_permission('staff.manage'::text)) AND (EXISTS ( SELECT 1 FROM users u WHERE ((u.id = user_roles.user_id) AND (u.tenant_id = (SELECT app.current_tenant_id())))))))
  WITH CHECK ((EXISTS ( SELECT 1 FROM users u WHERE ((u.id = user_roles.user_id) AND (u.tenant_id = (SELECT app.current_tenant_id()))))));

ALTER POLICY user_roles_read ON user_roles
  USING (((user_id = (SELECT app.current_user_id())) OR ((SELECT app.is_active_staff()) AND (EXISTS ( SELECT 1 FROM users u WHERE ((u.id = user_roles.user_id) AND (u.tenant_id = (SELECT app.current_tenant_id()))))))));

ALTER POLICY platform_all ON users
  USING ((SELECT app.is_platform_admin()))
  WITH CHECK ((SELECT app.is_platform_admin()));

ALTER POLICY user_self_read ON users
  USING ((id = (SELECT app.current_user_id())));

ALTER POLICY user_self_update ON users
  USING ((id = (SELECT app.current_user_id())))
  WITH CHECK ((id = (SELECT app.current_user_id())));

ALTER POLICY user_staff_manage ON users
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id())) AND (SELECT app.has_permission('staff.manage'::text))))
  WITH CHECK ((tenant_id = (SELECT app.current_tenant_id())));

ALTER POLICY user_staff_read ON users
  USING (((SELECT app.is_active_staff()) AND (tenant_id = (SELECT app.current_tenant_id()))));

-- Guard: every policy that mentions a hoistable helper must now mention it
-- only in (SELECT ...) form. Catches a partially-applied migration.
-- pg_get_expr renders a scalar subquery as "( SELECT app.f() AS f)" — note the
-- leading space — so that is what gets masked.
-- (PostgreSQL regexes have no lookbehind, so the hoisted prefix is masked out
-- first and anything still matching is by definition an un-hoisted call.)
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(c.relname || '.' || p.polname, ', ') INTO bad
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public',
  LATERAL (SELECT replace(
             coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' ||
             coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
             '( SELECT app.', '( SELECT hoisted.') AS e) x
  WHERE x.e ~ 'app\.(is_platform_admin|is_active_staff|current_tenant_id|current_user_id|current_kind|current_member_id|has_permission)\(';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'RLS hoisting incomplete, un-hoisted helper calls remain in: %', bad;
  END IF;
END $$;
