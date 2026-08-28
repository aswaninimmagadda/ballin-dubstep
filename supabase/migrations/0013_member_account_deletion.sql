-- ============================================================================
-- Member-initiated account deletion.
--
-- Apple review guideline 5.1.1(v) requires any app that supports account
-- creation to offer in-app account deletion, and Google Play requires both an
-- in-app path and a public web URL. The member app had neither, which is an
-- automatic rejection on both stores.
--
-- What "delete" means here has to be honest. The gym is the data controller
-- and is legally obliged to keep financial records (payments, receipts,
-- refunds are append-only by design and cannot be erased on request). So the
-- member action deletes the thing the member actually owns — their LOGIN —
-- and files a data-deletion request the gym must action for everything else.
-- The app says exactly this before the member confirms.
-- ============================================================================

CREATE TABLE member_deletion_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  member_id    uuid NOT NULL REFERENCES members(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  handled_at   timestamptz,
  handled_by   uuid REFERENCES users(id),
  note         text
);
CREATE UNIQUE INDEX member_deletion_open_unique
  ON member_deletion_requests(member_id) WHERE handled_at IS NULL;
CREATE INDEX member_deletion_tenant_idx ON member_deletion_requests(tenant_id, requested_at DESC);

ALTER TABLE member_deletion_requests ENABLE ROW LEVEL SECURITY;

-- Staff with members.view see their tenant's requests; members.edit closes one.
CREATE POLICY deletion_req_staff_select ON member_deletion_requests FOR SELECT USING (
  app.is_active_staff() AND tenant_id = app.current_tenant_id()
  AND app.has_permission('members.view')
);
CREATE POLICY deletion_req_staff_update ON member_deletion_requests FOR UPDATE USING (
  app.is_active_staff() AND tenant_id = app.current_tenant_id()
  AND app.has_permission('members.edit')
) WITH CHECK (tenant_id = app.current_tenant_id());
-- A member may see their own request (so the app can show it is pending).
CREATE POLICY deletion_req_member_select ON member_deletion_requests FOR SELECT USING (
  member_id = app.current_member_id()
);

GRANT SELECT, INSERT, UPDATE ON member_deletion_requests TO gymflow_app;

/**
 * Delete the CALLING member's login and file a deletion request.
 * SECURITY DEFINER because the app role cannot touch credential tables, and
 * because it must work for exactly one member: the authenticated caller.
 */
CREATE OR REPLACE FUNCTION app.member_delete_account()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m members%ROWTYPE; uid uuid;
BEGIN
  SELECT * INTO m FROM members WHERE id = app.current_member_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no member for this session' USING ERRCODE = 'no_data_found';
  END IF;
  uid := m.user_id;

  INSERT INTO member_deletion_requests (tenant_id, member_id)
  VALUES (m.tenant_id, m.id)
  ON CONFLICT (member_id) WHERE handled_at IS NULL DO NOTHING;

  IF uid IS NOT NULL THEN
    UPDATE sessions SET revoked_at = now() WHERE user_id = uid AND revoked_at IS NULL;
    UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = uid AND revoked_at IS NULL;
    DELETE FROM user_credentials WHERE user_id = uid;
    DELETE FROM user_roles WHERE user_id = uid;
    -- Unlink first: members.user_id references users(id).
    UPDATE members SET user_id = NULL WHERE id = m.id;
    DELETE FROM users WHERE id = uid AND kind = 'member';
  END IF;

  INSERT INTO audit_logs (tenant_id, actor_id, actor_label, action, entity_type, entity_id, after)
  VALUES (m.tenant_id, uid, 'member (self-service)', 'member.account_delete', 'member', m.id,
          jsonb_build_object('initiated_by', 'member'));
END $$;

REVOKE ALL ON FUNCTION app.member_delete_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.member_delete_account() TO gymflow_app;
