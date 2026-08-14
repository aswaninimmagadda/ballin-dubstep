-- Enable member-app access for a member: creates (or reuses) the member's
-- login user and sets the password hash. Reception runs this during
-- onboarding, so it is gated on members.edit (not staff.manage — member
-- logins are not staff accounts). SECURITY DEFINER because the app role
-- cannot touch user_credentials directly and receptionists cannot insert
-- into users.
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
    uid := m.user_id;
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

GRANT EXECUTE ON FUNCTION app.member_app_enable(uuid, text) TO gymflow_app;

-- Staff account creation likewise needs a sealed credential write. Gated on
-- staff.manage; the users/user_roles rows themselves are inserted by the
-- caller under normal RLS (user_staff_manage policy), this only sets the
-- password for a user of the caller's tenant.
CREATE OR REPLACE FUNCTION app.staff_set_initial_password(p_user uuid, p_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (app.is_platform_admin()
          OR (app.is_active_staff() AND app.has_permission('staff.manage')
              AND EXISTS (SELECT 1 FROM users u WHERE u.id = p_user
                          AND u.tenant_id = app.current_tenant_id()))) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO user_credentials (user_id, password_hash)
  VALUES (p_user, p_hash)
  ON CONFLICT (user_id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = now();
END $$;

GRANT EXECUTE ON FUNCTION app.staff_set_initial_password(uuid, text) TO gymflow_app;
