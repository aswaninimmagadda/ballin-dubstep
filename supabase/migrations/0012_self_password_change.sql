-- ============================================================================
-- Let people change their own password.
--
-- app.auth_set_password() already allowed a user to set their own credential,
-- but nothing in the product ever called it: staff and owners received a
-- one-time password at the desk and could never rotate it. A credential that
-- was read aloud once and can never be changed is the weakest link in an
-- otherwise sealed auth path.
--
-- Verifying the current password needs the stored hash, because scrypt lives
-- in the application tier — so expose it for the CALLER'S OWN account only.
-- The caller has already authenticated as that user; this hands them nothing
-- they could not obtain by logging in.
-- ============================================================================

CREATE OR REPLACE FUNCTION app.auth_self_credential()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.password_hash
  FROM user_credentials c
  WHERE c.user_id = app.current_user_id()
$$;

REVOKE ALL ON FUNCTION app.auth_self_credential() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.auth_self_credential() TO gymflow_app;
