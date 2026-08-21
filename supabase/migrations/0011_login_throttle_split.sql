-- ============================================================================
-- Split the login throttle into per-identifier and per-IP counters.
--
-- app.recent_failed_attempts() counted failures for the identifier OR the IP
-- and the app locked out at 8. A gym is behind ONE public IP and its staff
-- share one LAN, so eight fumbled member passwords locked out every
-- receptionist and every other member for fifteen minutes — a self-inflicted
-- denial of service at the busiest moment of the day.
--
-- The two signals mean different things and need different limits: a handful
-- of failures against one identifier is a wrong password; hundreds from one
-- address is an attack. The old function is kept (returning the identifier
-- count) so nothing that still calls it locks anyone out early.
-- ============================================================================

CREATE OR REPLACE FUNCTION app.login_attempt_counts(
  p_identifier text, p_ip text, p_window interval,
  OUT by_identifier bigint, OUT by_ip bigint
) RETURNS record LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    count(*) FILTER (WHERE identifier = lower(p_identifier)),
    count(*) FILTER (WHERE p_ip IS NOT NULL AND ip = p_ip)
  FROM login_attempts
  WHERE attempted_at > now() - p_window AND succeeded = false
$$;

REVOKE ALL ON FUNCTION app.login_attempt_counts(text, text, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.login_attempt_counts(text, text, interval) TO gymflow_app;

-- Narrow the legacy helper to the identifier only, so an unpatched caller
-- can no longer lock a whole gym out through a shared address.
CREATE OR REPLACE FUNCTION app.recent_failed_attempts(p_identifier text, p_ip text, p_window interval)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*) FROM login_attempts
  WHERE attempted_at > now() - p_window
    AND succeeded = false
    AND identifier = lower(p_identifier)
$$;

CREATE INDEX IF NOT EXISTS login_attempts_ip_idx
  ON login_attempts(ip, attempted_at) WHERE succeeded = false;
