-- ============================================================================
-- Review fixes round 2:
--  1. csv_import_stash — the CSV a staff user previews is parked server-side
--     between the preview POST and the confirm POST, so member PII never
--     travels in a URL query string (or server access logs).
--  2. app.member_sync_login_phone — editing a member's mobile also updates
--     their member-app login phone. Sealed users write: staff with
--     members.edit cannot touch users rows directly.
--  3. member_addons idempotency — double-submitting an add-on sale without a
--     payment must not create two packages.
-- ============================================================================

-- ---- 1. CSV import stash ----------------------------------------------------

CREATE TABLE csv_import_stash (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  created_by uuid NOT NULL REFERENCES users(id),
  csv        text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX csv_import_stash_tenant_idx ON csv_import_stash(tenant_id, created_at);

ALTER TABLE csv_import_stash ENABLE ROW LEVEL SECURITY;

CREATE POLICY stash_staff ON csv_import_stash FOR ALL USING (
  app.is_active_staff() AND tenant_id = app.current_tenant_id()
  AND app.has_permission('import.run')
) WITH CHECK (
  app.is_active_staff() AND tenant_id = app.current_tenant_id()
  AND app.has_permission('import.run')
);

-- 0003 granted table privileges before this table existed.
GRANT SELECT, INSERT, DELETE ON csv_import_stash TO gymflow_app;

-- ---- 2. Member login phone sync ---------------------------------------------

CREATE OR REPLACE FUNCTION app.member_sync_login_phone(p_member uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m members%ROWTYPE;
BEGIN
  IF NOT (app.is_active_staff() AND app.has_permission('members.edit')) THEN
    RAISE EXCEPTION 'not authorized to update member login'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO m FROM members WHERE id = p_member AND tenant_id = app.current_tenant_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'member not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF m.user_id IS NOT NULL THEN
    UPDATE users SET phone = m.mobile WHERE id = m.user_id AND kind = 'member';
  END IF;
END $$;

REVOKE ALL ON FUNCTION app.member_sync_login_phone(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.member_sync_login_phone(uuid) TO gymflow_app;

-- ---- 3. Archiving a member must end their app sessions ----------------------
-- Same scoping pattern as auth_set_password: members.edit staff may revoke
-- sessions of MEMBER logins only; staff targets still need staff.manage.

CREATE OR REPLACE FUNCTION app.sessions_revoke_all(p_user uuid)
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
    RAISE EXCEPTION 'not authorized' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE sessions SET revoked_at = now() WHERE user_id = p_user AND revoked_at IS NULL;
  UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = p_user AND revoked_at IS NULL;
END $$;

-- ---- 4. Add-on sale idempotency ---------------------------------------------

ALTER TABLE member_addons ADD COLUMN idempotency_key text;
CREATE UNIQUE INDEX member_addons_idem_unique
  ON member_addons(tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
