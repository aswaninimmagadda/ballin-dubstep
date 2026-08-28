-- ============================================================================
-- 0015 — authorization hardening
--
-- Three findings from the pre-release security review, each reproduced against
-- a migrated database as the runtime role gymflow_app.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Privilege escalation: any signed-in user could rewrite their own users row
--
--    user_self_update pinned only the row identity:
--      USING (id = app.current_user_id()) WITH CHECK (id = app.current_user_id())
--    so a receptionist could run
--      UPDATE users SET kind = 'platform_admin', tenant_id = NULL WHERE id = <self>
--    and the next request would build platform_admin claims, which the
--    platform_all policies honour on every table in the database.
--
--    The fix pins the two privilege-bearing columns to the values the caller's
--    claims already carry, so a self-update can never widen the caller's
--    reach: to write kind = 'platform_admin' you must already be one.
-- ----------------------------------------------------------------------------
ALTER POLICY user_self_update ON users
  USING (id = (SELECT app.current_user_id()))
  WITH CHECK (
    id = (SELECT app.current_user_id())
    AND kind = (SELECT app.current_kind())
    AND tenant_id IS NOT DISTINCT FROM (SELECT app.current_tenant_id())
  );

--    Pinning user_self_update alone was NOT enough, and the reason is worth
--    recording: permissive policies are OR'd, and for an UPDATE PostgreSQL
--    ORs the USING expressions and the WITH CHECK expressions SEPARATELY. The
--    user_staff_manage policy carried
--      USING (... AND app.has_permission('staff.manage'))
--      WITH CHECK (tenant_id = app.current_tenant_id())
--    so its check branch was satisfied by anyone whose row stayed in their own
--    tenant — no permission required — and that branch alone was enough to let
--    a member run `UPDATE users SET kind = 'staff' WHERE id = <self>`
--    (verified: "UPDATE 1" before this migration). A policy's WITH CHECK has
--    to repeat the authorization its USING clause makes, not assume it.
ALTER POLICY user_staff_manage ON users
  USING (
    (SELECT app.is_active_staff())
    AND tenant_id = (SELECT app.current_tenant_id())
    AND (SELECT app.has_permission('staff.manage'))
  )
  WITH CHECK (
    (SELECT app.is_active_staff())
    AND tenant_id = (SELECT app.current_tenant_id())
    AND (SELECT app.has_permission('staff.manage'))
    -- staff management creates and edits staff and member logins; it is never
    -- a route to platform_admin (which also requires tenant_id IS NULL).
    AND kind IN ('staff', 'member')
  );

-- ----------------------------------------------------------------------------
-- 2. Privilege escalation: app.member_app_enable() trusted members.user_id
--
--    The members UPDATE policy restricts which ROWS staff may write, not which
--    columns, so a receptionist holding members.edit could point any member row
--    at the owner's user id and then call app.member_app_enable() — a
--    SECURITY DEFINER function — to overwrite the OWNER's password hash.
--
--    Two independent fixes, either of which stops it:
--      a) the function refuses to write credentials for anything that is not a
--         member login in the same gym;
--      b) a trigger keeps members.user_id pointing at a member login in the
--         same gym, which is an invariant every legitimate write already meets.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.member_app_enable(p_member uuid, p_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m members%ROWTYPE;
  uid uuid;
  member_role uuid;
BEGIN
  IF NOT (app.is_active_staff() AND app.has_permission('members.edit')) THEN
    RAISE EXCEPTION 'not authorized to enable member app access'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO m FROM members WHERE id = p_member AND tenant_id = app.current_tenant_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'member not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF m.user_id IS NOT NULL THEN
    -- Never take the linked user on trust: this function writes a password,
    -- and the caller may only need members.edit to have set that column.
    SELECT u.id INTO uid FROM users u
      WHERE u.id = m.user_id AND u.kind = 'member' AND u.tenant_id = m.tenant_id;
    IF uid IS NULL THEN
      RAISE EXCEPTION 'member is not linked to a member login in this gym'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    -- Reuse an existing member login with this phone (e.g. re-joined member).
    SELECT id INTO uid FROM users
      WHERE tenant_id = m.tenant_id AND kind = 'member' AND phone = m.mobile;
    IF uid IS NULL THEN
      INSERT INTO users (kind, tenant_id, phone, display_name)
      VALUES ('member', m.tenant_id, m.mobile, m.first_name)
      RETURNING id INTO uid;
    END IF;
    UPDATE members SET user_id = uid WHERE id = m.id;
  END IF;

  INSERT INTO user_credentials (user_id, password_hash)
  VALUES (uid, p_hash)
  ON CONFLICT (user_id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = now();

  SELECT id INTO member_role FROM roles
    WHERE tenant_id = m.tenant_id AND key = 'member' LIMIT 1;
  IF member_role IS NOT NULL THEN
    INSERT INTO user_roles (user_id, role_id) VALUES (uid, member_role)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN uid;
END $$;

CREATE OR REPLACE FUNCTION app.members_guard_user_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- INSERT matters as much as UPDATE: members.create is a reception
  -- permission, so a receptionist could otherwise onboard a brand-new member
  -- already linked to the owner's login and take the same route.
  IF NEW.user_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = NEW.user_id AND u.kind = 'member' AND u.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'members.user_id must reference a member login in the same gym'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS members_guard_user_link ON members;
CREATE TRIGGER members_guard_user_link
  BEFORE INSERT OR UPDATE OF user_id ON members
  FOR EACH ROW EXECUTE FUNCTION app.members_guard_user_link();

-- ----------------------------------------------------------------------------
-- 3. Suspending a gym did not cut off its member app
--
--    Staff sessions and fresh member logins both check tenant status, but the
--    refresh path never did: a member holding a refresh token could rotate it
--    forever — new access token AND new 30-day refresh token — after the gym
--    was suspended or archived. Refresh is the long-lived credential, so this
--    was the one path that mattered.
--
--    app.refresh_consume now reports the tenant's status so the caller can
--    apply the same rule as login. Its shape changes, hence the DROP.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS app.refresh_consume(text);
CREATE FUNCTION app.refresh_consume(p_token_hash text)
RETURNS TABLE (user_id uuid, tenant_id uuid, kind text, is_active boolean, tenant_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tok refresh_tokens%ROWTYPE;
BEGIN
  SELECT * INTO tok FROM refresh_tokens
    WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF tok.revoked_at IS NOT NULL OR tok.expires_at <= now() THEN RETURN; END IF;
  IF tok.used_at IS NOT NULL THEN
    -- replayed token: kill all outstanding tokens for this user
    UPDATE refresh_tokens SET revoked_at = now()
      WHERE refresh_tokens.user_id = tok.user_id AND revoked_at IS NULL;
    RETURN;
  END IF;
  UPDATE refresh_tokens SET used_at = now() WHERE id = tok.id;
  RETURN QUERY
    SELECT u.id, u.tenant_id, u.kind, u.is_active, t.status
      FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
     WHERE u.id = tok.user_id;
END $$;

-- Signing out of the member app was client-side only: the app dropped its
-- copy of the tokens while the 30-day refresh token stayed valid on the
-- server. Give the app a way to actually hand it back.
CREATE OR REPLACE FUNCTION app.refresh_revoke_family(p_token_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tok refresh_tokens%ROWTYPE;
BEGIN
  SELECT * INTO tok FROM refresh_tokens WHERE token_hash = p_token_hash;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE refresh_tokens SET revoked_at = now()
    WHERE user_id = tok.user_id AND revoked_at IS NULL;
END $$;

REVOKE ALL ON FUNCTION app.refresh_consume(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.refresh_revoke_family(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.refresh_consume(text) TO gymflow_app;
GRANT EXECUTE ON FUNCTION app.refresh_revoke_family(text) TO gymflow_app;
