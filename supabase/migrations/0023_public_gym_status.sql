-- ============================================================================
-- 0023 — tell a member the difference between "no such gym" and "that gym is
-- not using the app at the moment".
--
-- app.public_gym_contact (0017) filters on status IN ('active','trial'),
-- which is right for the support-contact lookup it was written for. The
-- member sign-in route then reused it to check the gym code, so a member of
-- a gym whose subscription had lapsed was told "No gym with that code" —
-- sending them to re-check the one thing they had typed correctly, and
-- making the product look broken rather than the billing.
--
-- This returns the slug's existence separately from its usability. It says
-- only whether the gym can currently be signed in to, not why: whether a
-- particular gym is behind on its bill is the platform's business and the
-- gym's, not something to publish on an unauthenticated endpoint.
-- ============================================================================

CREATE OR REPLACE FUNCTION app.public_gym_signin_state(p_slug text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
           WHEN t.id IS NULL THEN 'unknown'
           WHEN t.status IN ('active', 'trial') THEN 'open'
           ELSE 'closed'
         END
  FROM (SELECT 1) AS one
  LEFT JOIN tenants t ON lower(t.slug) = lower(p_slug)
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION app.public_gym_signin_state(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_gym_signin_state(text) TO gymflow_app;
