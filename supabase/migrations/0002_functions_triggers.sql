-- ============================================================================
-- Claim helpers, integrity triggers, and atomic allocators.
--
-- Identity claims arrive as a JSON object in the `request.jwt.claims` setting
-- (the same mechanism PostgREST/Supabase uses), set per-transaction by the
-- application:  SELECT set_config('request.jwt.claims', '{"sub":"...", ...}', true)
-- Claims shape: { "sub": <user uuid>, "tenant_id": <uuid|null>, "kind": "staff" }
-- Permission checks always consult the database, never the claims payload, so
-- a revoked role takes effect immediately.
-- ============================================================================

CREATE OR REPLACE FUNCTION app.claims() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(app.claims() ->> 'sub', '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(app.claims() ->> 'tenant_id', '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.current_kind() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT app.claims() ->> 'kind'
$$;

-- SECURITY DEFINER: this looks up `users`, whose own policies call this
-- function — invoker rights would recurse infinitely.
CREATE OR REPLACE FUNCTION app.is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app.current_kind() = 'platform_admin'
    AND EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = app.current_user_id()
        AND u.kind = 'platform_admin'
        AND u.is_active
    )
$$;

-- SECURITY DEFINER so RLS on the RBAC tables doesn't recurse while checking.
CREATE OR REPLACE FUNCTION app.has_permission(perm text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN users u ON u.id = ur.user_id
    WHERE ur.user_id = app.current_user_id()
      AND u.is_active
      AND u.tenant_id = app.current_tenant_id()
      AND rp.permission = perm
  )
$$;

-- Staff belongs to the claimed tenant and is active.
CREATE OR REPLACE FUNCTION app.is_active_staff() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = app.current_user_id()
      AND u.kind = 'staff'
      AND u.is_active
      AND u.tenant_id = app.current_tenant_id()
      AND app.current_kind() = 'staff'
  )
$$;

-- The member row(s) belonging to the logged-in member-app user.
CREATE OR REPLACE FUNCTION app.current_member_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id FROM members m
  WHERE m.user_id = app.current_user_id()
    AND m.tenant_id = app.current_tenant_id()
    AND app.current_kind() = 'member'
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION app.has_permission(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.is_active_staff() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.current_member_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.claims(), app.current_user_id(), app.current_tenant_id(),
  app.current_kind(), app.is_platform_admin(), app.has_permission(text),
  app.is_active_staff(), app.current_member_id() TO gymflow_app;

-- ----------------------------------------------------------------------------
-- updated_at maintenance
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants','brands','branches','users','trainers','members','membership_plans',
    'addon_packages','memberships','member_addons','trainer_sessions','leads',
    'promotions','notification_templates','gym_settings'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_touch BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()',
      t, t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- Financial immutability. Payments/receipts/refunds/audit rows are
-- append-only. The single permitted payment mutation is the refund-status
-- transition. Enforced in the database so no application bug (or curious
-- staff member with SQL access via a leaked app credential) can rewrite
-- history.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME
    USING ERRCODE = 'raise_exception', HINT = 'Corrections must be made with new records (e.g. refunds).';
END $$;

CREATE OR REPLACE FUNCTION app.payments_guard_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Only the status column may change, and only into refund states.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.member_id IS DISTINCT FROM OLD.member_id
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.method IS DISTINCT FROM OLD.method
     OR NEW.payment_date IS DISTINCT FROM OLD.payment_date
     OR NEW.external_reference IS DISTINCT FROM OLD.external_reference
     OR NEW.received_by IS DISTINCT FROM OLD.received_by
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'payments are immutable; only status may transition'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF NOT (NEW.status IN ('refunded','partially_refunded') OR NEW.status = OLD.status) THEN
    RAISE EXCEPTION 'invalid payment status transition % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
CREATE TRIGGER payments_guard BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION app.payments_guard_update();
CREATE TRIGGER receipts_no_update BEFORE UPDATE OR DELETE ON receipts
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
CREATE TRIGGER refunds_no_update BEFORE UPDATE OR DELETE ON refunds
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
CREATE TRIGGER allocations_no_update BEFORE UPDATE OR DELETE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

-- ----------------------------------------------------------------------------
-- Atomic allocators (concurrency-safe under simultaneous receptionists)
-- ----------------------------------------------------------------------------

-- Allocate the next receipt sequence for (tenant, fiscal year). The UPDATE
-- takes a row lock, so two concurrent transactions can never receive the
-- same number — one blocks until the other commits.
CREATE OR REPLACE FUNCTION app.next_receipt_seq(p_tenant uuid, p_fy text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE seq bigint;
BEGIN
  IF NOT (app.is_platform_admin()
          OR (app.is_active_staff() AND p_tenant = app.current_tenant_id())) THEN
    RAISE EXCEPTION 'not authorized to allocate receipts for this tenant'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO receipt_sequences (tenant_id, fiscal_year, next_seq)
  VALUES (p_tenant, p_fy, 1)
  ON CONFLICT (tenant_id, fiscal_year) DO NOTHING;

  UPDATE receipt_sequences
  SET next_seq = next_seq + 1
  WHERE tenant_id = p_tenant AND fiscal_year = p_fy
  RETURNING next_seq - 1 INTO seq;

  RETURN seq;
END $$;

-- Allocate the next human-readable membership number for a tenant.
CREATE OR REPLACE FUNCTION app.next_membership_number(p_tenant uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n bigint; prefix text;
BEGIN
  IF NOT (app.is_platform_admin()
          OR (app.is_active_staff() AND p_tenant = app.current_tenant_id())) THEN
    RAISE EXCEPTION 'not authorized to allocate membership numbers for this tenant'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE gym_settings
  SET membership_number_next = membership_number_next + 1
  WHERE tenant_id = p_tenant
  RETURNING membership_number_next - 1, membership_number_prefix INTO n, prefix;
  IF n IS NULL THEN
    RAISE EXCEPTION 'gym_settings row missing for tenant %', p_tenant;
  END IF;
  RETURN prefix || lpad(n::text, 4, '0');
END $$;

GRANT EXECUTE ON FUNCTION app.next_receipt_seq(uuid, text) TO gymflow_app;
GRANT EXECUTE ON FUNCTION app.next_membership_number(uuid) TO gymflow_app;

-- ----------------------------------------------------------------------------
-- Grants: the app role gets table-level DML; RLS (0003) restricts rows.
-- login/credential tables are intentionally NOT granted to gymflow_app for
-- SELECT-by-anyone — access is still via the app role but RLS keeps rows
-- scoped; credentials are only readable inside SECURITY DEFINER auth checks
-- performed by the application with explicit queries.
-- ----------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gymflow_app;
-- Financial tables: no DELETE even at grant level (defense in depth).
REVOKE DELETE ON payments, receipts, refunds, payment_allocations, audit_logs FROM gymflow_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO gymflow_app;
