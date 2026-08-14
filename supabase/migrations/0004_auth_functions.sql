-- ============================================================================
-- Authentication data path. The app role has NO direct access to
-- user_credentials / sessions / refresh_tokens / login_attempts (revoked in
-- 0003). Everything goes through these SECURITY DEFINER functions, which keep
-- the attack surface small and auditable. Password verification itself
-- happens in the application (scrypt) — the DB only returns the stored hash
-- for one identified user per call, never lists of hashes.
-- ============================================================================

-- ---- Login lookups ---------------------------------------------------------

CREATE OR REPLACE FUNCTION app.auth_staff_lookup(p_email text)
RETURNS TABLE (
  user_id uuid, tenant_id uuid, kind text, display_name text, language text,
  is_active boolean, password_hash text, tenant_status text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.tenant_id, u.kind, u.display_name, u.language, u.is_active,
         c.password_hash, t.status
  FROM users u
  JOIN user_credentials c ON c.user_id = u.id
  LEFT JOIN tenants t ON t.id = u.tenant_id
  WHERE u.email = lower(p_email) AND u.kind IN ('staff','platform_admin')
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app.auth_member_lookup(p_slug text, p_phone text)
RETURNS TABLE (
  user_id uuid, tenant_id uuid, member_id uuid, display_name text, language text,
  is_active boolean, password_hash text, tenant_status text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.tenant_id, m.id, u.display_name, u.language, u.is_active,
         c.password_hash, t.status
  FROM tenants t
  JOIN users u ON u.tenant_id = t.id AND u.kind = 'member' AND u.phone = p_phone
  JOIN user_credentials c ON c.user_id = u.id
  LEFT JOIN members m ON m.user_id = u.id AND m.tenant_id = t.id
  WHERE t.slug = lower(p_slug)
  LIMIT 1
$$;

-- Set (or reset) a user's password hash. Caller must be staff of the same
-- tenant with staff.manage/members.edit, the user themself, or platform admin.
CREATE OR REPLACE FUNCTION app.auth_set_password(p_user uuid, p_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (
    p_user = app.current_user_id()
    OR app.is_platform_admin()
    OR (app.is_active_staff()
        AND (app.has_permission('staff.manage') OR app.has_permission('members.edit'))
        AND EXISTS (SELECT 1 FROM users u WHERE u.id = p_user
                    AND u.tenant_id = app.current_tenant_id()))
  ) THEN
    RAISE EXCEPTION 'not authorized to set password' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO user_credentials (user_id, password_hash)
  VALUES (p_user, p_hash)
  ON CONFLICT (user_id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = now();
END $$;

-- ---- Sessions (staff web) --------------------------------------------------

CREATE OR REPLACE FUNCTION app.session_create(
  p_user uuid, p_token_hash text, p_expires timestamptz, p_ip text, p_ua text
) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent)
  VALUES (p_user, p_token_hash, p_expires, p_ip, left(p_ua, 300))
  RETURNING id
$$;

CREATE OR REPLACE FUNCTION app.session_lookup(p_token_hash text)
RETURNS TABLE (
  session_id uuid, user_id uuid, tenant_id uuid, kind text, display_name text,
  language text, is_active boolean, tenant_status text, expires_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, u.id, u.tenant_id, u.kind, u.display_name, u.language, u.is_active,
         t.status, s.expires_at
  FROM sessions s
  JOIN users u ON u.id = s.user_id
  LEFT JOIN tenants t ON t.id = u.tenant_id
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app.session_revoke(p_token_hash text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE sessions SET revoked_at = now() WHERE token_hash = p_token_hash AND revoked_at IS NULL
$$;

-- Revoke every session/refresh token for a user (deactivation, password change).
CREATE OR REPLACE FUNCTION app.sessions_revoke_all(p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (
    p_user = app.current_user_id()
    OR app.is_platform_admin()
    OR (app.is_active_staff() AND app.has_permission('staff.manage')
        AND EXISTS (SELECT 1 FROM users u WHERE u.id = p_user
                    AND u.tenant_id = app.current_tenant_id()))
  ) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE sessions SET revoked_at = now() WHERE user_id = p_user AND revoked_at IS NULL;
  UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = p_user AND revoked_at IS NULL;
END $$;

-- ---- Refresh tokens (member app), single-use rotation ----------------------

CREATE OR REPLACE FUNCTION app.refresh_create(p_user uuid, p_token_hash text, p_expires timestamptz)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
  VALUES (p_user, p_token_hash, p_expires)
  RETURNING id
$$;

-- Atomically consume a refresh token. Returns the user if the token was
-- valid and unused; marks it used. A reused token (replay) revokes the whole
-- family for that user as a defensive measure.
CREATE OR REPLACE FUNCTION app.refresh_consume(p_token_hash text)
RETURNS TABLE (user_id uuid, tenant_id uuid, kind text, is_active boolean)
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
    SELECT u.id, u.tenant_id, u.kind, u.is_active FROM users u WHERE u.id = tok.user_id;
END $$;

-- ---- Login throttling ------------------------------------------------------

CREATE OR REPLACE FUNCTION app.record_login_attempt(p_identifier text, p_ip text, p_success boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO login_attempts (identifier, ip, succeeded)
  VALUES (lower(p_identifier), p_ip, p_success)
$$;

-- Failed attempts in the recent window for identifier or IP. The app locks
-- out when this crosses its threshold.
CREATE OR REPLACE FUNCTION app.recent_failed_attempts(p_identifier text, p_ip text, p_window interval)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*) FROM login_attempts
  WHERE attempted_at > now() - p_window
    AND succeeded = false
    AND (identifier = lower(p_identifier) OR (p_ip IS NOT NULL AND ip = p_ip))
$$;

-- Prune old attempts (called opportunistically).
CREATE OR REPLACE FUNCTION app.prune_login_attempts()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM login_attempts WHERE attempted_at < now() - interval '7 days'
$$;

-- ---- Grants ----------------------------------------------------------------

GRANT EXECUTE ON FUNCTION
  app.auth_staff_lookup(text),
  app.auth_member_lookup(text, text),
  app.auth_set_password(uuid, text),
  app.session_create(uuid, text, timestamptz, text, text),
  app.session_lookup(text),
  app.session_revoke(text),
  app.sessions_revoke_all(uuid),
  app.refresh_create(uuid, text, timestamptz),
  app.refresh_consume(text),
  app.record_login_attempt(text, text, boolean),
  app.recent_failed_attempts(text, text, interval),
  app.prune_login_attempts()
TO gymflow_app;
