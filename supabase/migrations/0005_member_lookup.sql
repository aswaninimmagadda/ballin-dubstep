-- Definer lookup used by the member-app token refresh path: resolve the
-- member row for a user id without ambient claims. Returns at most one row
-- and only id-level data.
CREATE OR REPLACE FUNCTION app.auth_member_by_user(p_user uuid)
RETURNS TABLE (member_id uuid, tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, m.tenant_id FROM members m WHERE m.user_id = p_user LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION app.auth_member_by_user(uuid) TO gymflow_app;
