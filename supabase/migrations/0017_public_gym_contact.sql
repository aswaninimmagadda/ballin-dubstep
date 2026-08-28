-- ============================================================================
-- 0017 — public gym contact lookup for the account-deletion page
--
-- Google Play requires a web URL, reachable without installing the app, where
-- a user can find out how to delete their account. Ours told them to "contact
-- reception using the phone number on your receipt" and then gave no phone
-- number, no form and no address — a dead end, which is a rejection.
--
-- The page needs the gym's public support contact without a login, so it needs
-- one narrow SECURITY DEFINER read. Deliberately minimal: an active tenant's
-- display name and the support phone/WhatsApp it already prints on receipts
-- and its shopfront. No member data, no counts, nothing that is not already
-- public about the business.
-- ============================================================================
CREATE OR REPLACE FUNCTION app.public_gym_contact(p_slug text)
RETURNS TABLE (gym_name text, support_phone text, support_whatsapp text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(b.name, t.name), b.support_phone, b.support_whatsapp
  FROM tenants t
  LEFT JOIN brands b ON b.tenant_id = t.id
  WHERE lower(t.slug) = lower(p_slug)
    AND t.status IN ('active', 'trial')
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION app.public_gym_contact(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_gym_contact(text) TO gymflow_app;
