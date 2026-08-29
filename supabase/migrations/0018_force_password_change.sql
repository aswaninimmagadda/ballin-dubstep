-- ============================================================================
-- 0018 — one-time passwords must actually be one-time
--
-- user_credentials.must_change has existed since 0001 and nothing has ever
-- read it. Every staff account is created with a password generated at the
-- desk and read aloud, and every reset issues another one the same way — so
-- the credential a person is most likely to still be using six months later
-- is the one that was spoken across a counter, possibly written down, and seen
-- by whoever issued it. The column was the control; it was never wired up.
--
-- Set on issuance, cleared when the holder chooses their own password, and
-- surfaced to the app so it can require the change before anything else.
-- ============================================================================

-- Staff accounts created at the desk, and desk resets, carry an unchosen
-- password from the moment they are issued.
CREATE OR REPLACE FUNCTION app.staff_set_initial_password(p_user uuid, p_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (app.is_active_staff() AND app.has_permission('staff.manage')) THEN
    RAISE EXCEPTION 'not authorized to set staff passwords'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = p_user AND u.kind = 'staff' AND u.tenant_id = app.current_tenant_id()
  ) THEN
    RAISE EXCEPTION 'staff account not found in this gym' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO user_credentials (user_id, password_hash, must_change)
  VALUES (p_user, p_hash, true)
  ON CONFLICT (user_id) DO UPDATE
    SET password_hash = excluded.password_hash, must_change = true, updated_at = now();
  -- A reset is also a revocation: whoever held the old password loses their
  -- sessions with it.
  UPDATE sessions SET revoked_at = now() WHERE user_id = p_user AND revoked_at IS NULL;
END $$;

-- Who set it decides whether it counts as chosen.
--
-- Setting your OWN password clears the flag — that is the whole point of it.
-- Anyone setting it FOR someone else is issuing a one-time password: it was
-- generated, spoken and handed over, so the holder must replace it.
--
-- The authorization rules are exactly those of migration 0008 and are
-- deliberately unchanged: members.edit reaches member logins only, staff
-- targets need staff.manage, and both are tenant-scoped.
CREATE OR REPLACE FUNCTION app.auth_set_password(p_user uuid, p_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE is_self boolean := (p_user = app.current_user_id());
BEGIN
  IF NOT (
    is_self
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
  INSERT INTO user_credentials (user_id, password_hash, must_change)
  VALUES (p_user, p_hash, NOT is_self)
  ON CONFLICT (user_id) DO UPDATE
    SET password_hash = excluded.password_hash,
        must_change = NOT is_self,
        updated_at = now();
END $$;

-- The login paths need to know, so the app can send the holder to the
-- change-password screen instead of into the product.
DROP FUNCTION IF EXISTS app.auth_staff_lookup(text);
CREATE FUNCTION app.auth_staff_lookup(p_email text)
RETURNS TABLE (
  user_id uuid, tenant_id uuid, kind text, display_name text, language text,
  is_active boolean, password_hash text, tenant_status text, must_change boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.tenant_id, u.kind, u.display_name, u.language, u.is_active,
         c.password_hash, t.status, c.must_change
  FROM users u
  JOIN user_credentials c ON c.user_id = u.id
  LEFT JOIN tenants t ON t.id = u.tenant_id
  WHERE u.email = lower(p_email) AND u.kind IN ('staff','platform_admin')
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION app.auth_staff_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.auth_staff_lookup(text) TO gymflow_app;

-- The session carries the flag too, so the requirement survives a page load
-- rather than being something the login screen could set and forget.
DROP FUNCTION IF EXISTS app.session_lookup(text);
CREATE FUNCTION app.session_lookup(p_token_hash text)
RETURNS TABLE (
  session_id uuid, user_id uuid, tenant_id uuid, kind text, display_name text,
  language text, is_active boolean, tenant_status text, expires_at timestamptz,
  must_change boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, u.id, u.tenant_id, u.kind, u.display_name, u.language, u.is_active,
         t.status, s.expires_at, coalesce(c.must_change, false)
  FROM sessions s
  JOIN users u ON u.id = s.user_id
  LEFT JOIN tenants t ON t.id = u.tenant_id
  LEFT JOIN user_credentials c ON c.user_id = u.id
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION app.session_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.session_lookup(text) TO gymflow_app;
